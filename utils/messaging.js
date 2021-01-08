const fs = require('fs')
const path = require('path')
const Queue = require('bull')
const Telegram = require('telegraf/telegram')
const I18n = require('telegraf-i18n')
const replicators = require('telegraf/core/replicators')
const {
  db
} = require('../database')

const telegram = new Telegram(process.env.BOT_TOKEN)

const i18n = new I18n({
  directory: path.resolve(__dirname, '../locales'),
  defaultLanguage: 'uk',
  defaultLanguageOnMissing: true
})

const messaging = (messagingData) => new Promise((resolve) => {
  console.log(`messaging ${messagingData.name} start`)
  let newMessaging = true
  if (messagingData.status === -1) newMessaging = false

  messagingData.status = 1
  messagingData.save()
  const messages = {}

  let messagingCreator

  db.User.findById(messagingData.creator).then((data) => {
    messagingCreator = data
  })

  const jobName = `messaging_${messagingData.id}`

  const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))

  const queue = new Queue(jobName, {
    limiter: {
      max: config.messaging.limit.max || 10,
      duration: config.messaging.limit.duration || 1000
    }
  })

  queue.process((job, done) => {
    const method = replicators.copyMethods[job.data.message.type]
    const opts = Object.assign(job.data.message.data, {
      chat_id: job.data.chatId,
      disable_notification: true
    })

    telegram.callApi(method, opts).then((result) => {
      messages[job.data.chatId] = result.message_id

      done()
    }).catch((error) => {
      console.log(error.description)
      if (error.description === 'Forbidden: bot was blocked by the user') {
      } else {
        if (messagingCreator) {
          telegram.sendMessage(messagingCreator.telegram_id, i18n.t('uk', 'admin.messaging.send_error', {
            name: messagingData.name,
            telegramId: job.data.chatId,
            errorMessage: error.message
          }), {
            parse_mode: 'HTML'
          })
        }
      }
      messagingData.sendErrors.push({
        telegram_id: job.data.chatId,
        errorMessage: error.message
      })

      done(new Error(error))
    })
  })

  if (newMessaging) {
    messagingData.users.forEach(chatId => {
      queue.add({
        chatId,
        message: messagingData.message
      })
    })
  }

  const interval = setInterval(async () => {
    const jobCounts = await queue.getJobCounts()

    messagingData = await db.Messaging.findById(messagingData.id)

    if (messagingData.status >= 2) queue.clean(0, 'delayed')

    messagingData.result = jobCounts

    if (jobCounts.waiting <= 0 && jobCounts.delayed <= 0) {
      messagingData.status = 2
      resolve({
        jobCounts
      })
      clearInterval(interval)

      console.log(`messaging ${messagingData.name} end`, jobCounts)

      messagingData.messages = messages
    }

    await messagingData.save()
  }, 5000)
})

const messagingEdit = (messagingData) => new Promise((resolve) => {
  let newMessaging = true
  if (messagingData.status === -1) {
    messagingData.status = 2
    newMessaging = false
  }

  messagingData.editStatus = 2
  messagingData.save()

  const jobName = `messaging_edit_${messagingData.id}`

  const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))

  const queue = new Queue(jobName, {
    limiter: {
      max: config.messaging.limit.max || 10,
      duration: config.messaging.limit.duration || 1000
    }
  })

  queue.process((job, done) => {
    if (job.data.message.type === 'text') {
      telegram.editMessageText(job.data.chatId, job.data.messageId, null, job.data.message.data.text, {
        parse_mode: job.data.message.data.parse_mode,
        disable_web_page_preview: job.data.message.data.disable_web_page_preview,
        reply_markup: job.data.message.data.reply_markup
      }).then((result) => {
        done()
      }).catch((error) => {
        console.log(error)
        done(new Error(error))
      })
    } else {
      telegram.editMessageMedia(job.data.chatId, job.data.messageId, null, {
        type: job.data.message.type,
        media: job.data.message.data[job.data.message.type],
        caption: job.data.message.data.caption || '',
        parse_mode: job.data.message.data.parse_mode
      }, {
        parse_mode: job.data.message.data.parse_mode,
        disable_web_page_preview: job.data.message.data.disable_web_page_preview,
        reply_markup: job.data.message.data.reply_markup
      }).then((result) => {
        done()
      }).catch((error) => {
        console.log(error)
        done(new Error(error))
      })
    }
  })

  if (newMessaging) {
    messagingData.users.forEach(chatId => {
      console.log(messagingData.messages)
      queue.add({
        chatId,
        messageId: messagingData.messages[chatId],
        message: messagingData.message
      })
    })
  }

  const interval = setInterval(async () => {
    const jobCounts = await queue.getJobCounts()

    messagingData = await db.Messaging.findById(messagingData.id)

    if (messagingData.editStatus === 0) queue.clean(0, 'delayed')

    messagingData.result = jobCounts

    if (jobCounts.waiting <= 0 && jobCounts.delayed <= 0) {
      messagingData.editStatus = 0
      resolve({
        jobCounts
      })
      clearInterval(interval)

      console.log(`messaging edit ${messagingData.name} end`, jobCounts)
    }

    await messagingData.save()
  }, 5000)
})

setTimeout(async function f () {
  const cursorMessaging = await db.Messaging.find({
    status: { $lte: 0 },
    date: {
      $lte: new Date()
    }
  }).cursor()

  cursorMessaging.on('data', messaging)

  const cursorMessagingEdit = await db.Messaging.find({
    editStatus: 1,
    date: {
      $lte: new Date()
    }
  }).cursor()

  cursorMessagingEdit.on('data', messagingEdit)

  setTimeout(f, 5000)
}, 5000)

const restartMessaging = async () => {
  const cursorMessaging = await db.Messaging.find({
    status: 1,
    date: {
      $lte: new Date()
    }
  }).cursor()

  cursorMessaging.on('data', (messagingData) => {
    messagingData.status = -1
    messagingData.save()
  })

  const cursorMessagingEdit = await db.Messaging.find({
    editStatus: 2,
    date: {
      $lte: new Date()
    }
  }).cursor()

  cursorMessagingEdit.on('data', (messagingData) => {
    messagingData.status = -1
    messagingData.save()
  })
}

restartMessaging()
