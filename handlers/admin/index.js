const got = require('got')
const Composer = require('telegraf/composer')
const Markup = require('telegraf/markup')
const I18n = require('telegraf-i18n')
const Freekassa = require('@alex-kondakov/freekassa')
const CryptoPay = require('@foile/crypto-pay-api')

const cryptoPay = new CryptoPay.CryptoPay(process.env.CRYPTOPAY_API_KEY)

const i18n = new I18n({
  directory: `${__dirname}/../../locales`,
  defaultLanguage: 'en',
  sessionName: 'session',
  useSession: true,
  allowMissing: false,
  skipPluralize: true
})

const composer = new Composer()

const checkAdminRight = (ctx, next) => {
  if (ctx.config.mainAdminId === ctx.from.id || (ctx.session.userInfo.adminRights && ctx.session.userInfo.adminRights.length > 0)) return next()
  else return ctx.replyWithHTML('You are not admin')
}

const adminType = [
  'messaging',
  'pack'
]

const main = async (ctx, next) => {
  const resultText = 'Admin panel'

  const inlineKeyboard = []
  adminType.forEach((type) => {
    if (ctx.config.mainAdminId === ctx.from.id || ctx.session.userInfo.adminRights.includes(type)) inlineKeyboard.push([Markup.callbackButton(`Admin ${type}`, `admin:${type}`)])
  })

  const replyMarkup = Markup.inlineKeyboard(inlineKeyboard)

  if (ctx.callbackQuery) {
    await ctx.editMessageText(resultText, {
      parse_mode: 'HTML',
      reply_markup: replyMarkup
    }).catch(() => {})
  } else {
    await ctx.replyWithHTML(resultText, {
      reply_markup: replyMarkup
    })
  }
}

const setPremium = async (ctx, next) => {
  const userId = ctx.match[1]
  const credit = parseInt(ctx.match[2])

  let findUser

  findUser = await ctx.db.User.findOne({
    telegram_id: parseInt(userId) || 0
  })

  if (!findUser) {
    findUser = await ctx.db.User.findOne({
      username: userId
    })
  }

  if (!findUser) return ctx.replyWithHTML('User not found')

  findUser.balance += credit

  await findUser.save()

  await ctx.replyWithHTML(`User ${findUser.telegram_id} (${findUser.username}) balance updated to ${findUser.balance} credit (added ${credit} credit)`)

  if (credit !== 0) {
    await ctx.telegram.sendMessage(findUser.telegram_id, i18n.t(findUser.locale, 'donate.update', {
      amount: credit,
      balance: findUser.balance
    }), {
      parse_mode: 'HTML'
    })
  }
}

const getLastCryptoTransactions = async (ctx, next) => {
  const result = await cryptoPay.getInvoices({
    status: 'paid',
    count: 10
  })

  const resultText = result.items.map((item) => {
    return `~~~~~~~~~~~~~~~~~~~~~~\n<b>${item.description}</b>\n${item.amount} ${item.asset} (${new Date(item.paid_at).toLocaleString()})`
  })

  await ctx.replyWithHTML(`<b>Last crypto transactions</b>\n\n${resultText.join('\n')}\n~~~~~~~~~~~~~~~~~~~~~~`, {
    disable_web_page_preview: true
  })
}

const getFreeKassaTransactions = async (ctx, next) => {
  const freekassa = Freekassa.init()
  freekassa.shopId = process.env.FREEKASSA_SHOP_ID
  freekassa.key = process.env.FREEKASSA_API_KEY
  freekassa.orderCount = 10
  freekassa.orderStatus = 1

  const result = await freekassa.orders()

  const resultText = result.orders.map((item) => {
    return `~~~~~~~~~~~~~~~~~~~~~~\n<b>${item.merchant_order_id}</b>\n${item.amount} ${item.currency} (${new Date(item.date).toLocaleString()})`
  })

  await ctx.replyWithHTML(`<b>Last FreeKassa transactions</b>\n\n${resultText.join('\n')}\n~~~~~~~~~~~~~~~~~~~~~~`, {
    disable_web_page_preview: true
  })
}

const getLastMonoTransactions = async (ctx, next) => {
  const result = await got(`https://api.monobank.ua/personal/statement/${process.env.MONO_ACCOUNT}/${Math.floor(Date.now() / 1000) - 86400 * 3}`, {
    headers: {
      'X-Token': process.env.MONO_TOKEN
    }
  }).json()

  const resultText = result.map((item) => {
    return `~~~~~~~~~~~~~~~~~~~~~~\n<b>${item.description}</b>\n<code>${item.comment}</code>\n${item.amount / 100} ${item.currencyCode} (${new Date(item.time * 1000).toLocaleString()})`
  })

  await ctx.replyWithHTML(`<b>Last MonoBank transactions</b>\n\n${resultText.join('\n')}\n~~~~~~~~~~~~~~~~~~~~~~`, {
    disable_web_page_preview: true
  })
}

adminType.forEach((type) => {
  composer.use(Composer.optional((ctx) => {
    return ctx.config.mainAdminId === ctx?.from?.id || (ctx.session.userInfo.adminRights && ctx.session.userInfo.adminRights.includes(type))
  }, require(`./${type}`)))
})

composer.command('admin', checkAdminRight, main)

composer.hears(/\/credit (.*?) (-?\d+)/, checkAdminRight, setPremium)
composer.command('crypto', checkAdminRight, getLastCryptoTransactions)
composer.command('fk', checkAdminRight, getFreeKassaTransactions)
composer.command('mono', checkAdminRight, getLastMonoTransactions)

composer.hears([I18n.match('start.menu.admin')], checkAdminRight, main)
composer.action(/admin:(.*)/, checkAdminRight, main)

module.exports = composer
