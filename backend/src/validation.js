const usernamePattern = /^[a-zA-Z0-9_.-]{3,32}$/
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const categories = new Set(['کاری', 'پروژه', 'شخصی', 'آموزش', 'مالی'])
const statuses = new Set(['active', 'completed'])

export function normalizeDigits(value) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit) % 10))
}

function invalid(fields) {
  const error = new Error('اطلاعات واردشده معتبر نیست.')
  error.status = 400
  error.code = 'VALIDATION_ERROR'
  error.fields = fields
  return error
}

function bodyObject(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {}
}

export function validateRegistration(input) {
  const body = bodyObject(input)
  const fields = {}
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  const nationalId = typeof body.nationalId === 'string' ? normalizeDigits(body.nationalId.trim()) : ''
  const identityInfo = typeof body.identityInfo === 'string' ? body.identityInfo.trim() : ''

  if (!usernamePattern.test(username)) fields.username = 'نام کاربری باید ۳ تا ۳۲ نویسه و شامل حروف لاتین یا اعداد باشد.'
  if (password.length < 8 || password.length > 128) fields.password = 'رمز عبور باید بین ۸ تا ۱۲۸ نویسه باشد.'
  if (email.length > 254 || !emailPattern.test(email)) fields.email = 'ایمیل معتبر وارد کنید.'
  if (fullName.length < 2 || fullName.length > 100) fields.fullName = 'نام و نام خانوادگی باید بین ۲ تا ۱۰۰ نویسه باشد.'
  if (!/^\d{10}$/.test(nationalId)) fields.nationalId = 'کد ملی باید ۱۰ رقم باشد.'
  if (identityInfo.length > 500) fields.identityInfo = 'اطلاعات هویتی نباید بیشتر از ۵۰۰ نویسه باشد.'
  if (Object.keys(fields).length) throw invalid(fields)

  return { username, password, email, fullName, nationalId, identityInfo }
}

export function validateLogin(input) {
  const body = bodyObject(input)
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const fields = {}
  if (!username || username.length > 32) fields.username = 'نام کاربری معتبر وارد کنید.'
  if (!password || password.length > 128) fields.password = 'رمز عبور را وارد کنید.'
  if (Object.keys(fields).length) throw invalid(fields)
  return { username, password }
}

export function validateNote(input, partial = false) {
  const body = bodyObject(input)
  const fields = {}
  const allowed = ['title', 'content', 'category', 'status']
  if (!Object.keys(body).length) {
    throw invalid({ note: partial ? 'حداقل یکی از فیلدهای یادداشت باید ارسال شود.' : 'عنوان یادداشت الزامی است.' })
  }
  if (Object.keys(body).some((field) => !allowed.includes(field))) {
    throw invalid({ note: 'فقط فیلدهای عنوان، توضیحات، دسته‌بندی و وضعیت پذیرفته می‌شوند.' })
  }

  const note = {}
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 120) {
      fields.title = 'عنوان الزامی و حداکثر ۱۲۰ نویسه است.'
    } else note.title = body.title.trim()
  } else if (!partial) {
    fields.title = 'عنوان یادداشت الزامی است.'
  }

  if ('content' in body) {
    if (typeof body.content !== 'string' || body.content.length > 2000) fields.content = 'توضیحات نباید بیشتر از ۲۰۰۰ نویسه باشد.'
    else note.content = body.content.trim()
  } else if (!partial) {
    note.content = ''
  }

  if ('category' in body) {
    if (typeof body.category !== 'string' || !categories.has(body.category)) fields.category = 'دسته‌بندی انتخاب‌شده معتبر نیست.'
    else note.category = body.category
  } else if (!partial) {
    note.category = 'کاری'
  }

  if ('status' in body) {
    if (typeof body.status !== 'string' || !statuses.has(body.status)) fields.status = 'وضعیت انتخاب‌شده معتبر نیست.'
    else note.status = body.status
  } else if (!partial) {
    note.status = 'active'
  }

  if (Object.keys(fields).length) throw invalid(fields)
  return note
}

export function isValidId(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}
