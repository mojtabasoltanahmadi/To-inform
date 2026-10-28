<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { CreditCard, LockKeyhole, Mail, UserRound } from '../icons.js'
import AppBrand from '../components/AppBrand.vue'
import { apiRequest, setSession } from '../services/api.js'

const props = defineProps({
  mode: { type: String, required: true },
})

const router = useRouter()
const isRegister = computed(() => props.mode === 'register')
const busy = ref(false)
const error = ref('')
const fieldErrors = ref({})
const showRecoveryMessage = ref(false)
const form = reactive({
  username: '',
  password: '',
  email: '',
  fullName: '',
  nationalId: '',
  identityInfo: '',
  remember: false,
})

function normalizeDigits(value) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩'.indexOf(digit) % 10))
}

function clearFieldError(field) {
  if (!fieldErrors.value[field]) return
  const next = { ...fieldErrors.value }
  delete next[field]
  fieldErrors.value = next
}

function validate() {
  const errors = {}
  const username = form.username.trim()
  if (!username) errors.username = 'نام کاربری را وارد کنید.'
  else if (username.length < 3 || username.length > 32 || (isRegister.value && !/^[a-zA-Z0-9_.-]+$/.test(username))) errors.username = 'نام کاربری باید ۳ تا ۳۲ نویسه و شامل حروف لاتین یا اعداد باشد.'

  if (!form.password) errors.password = 'رمز عبور را وارد کنید.'
  else if (isRegister.value && form.password.length < 8) errors.password = 'رمز عبور باید حداقل ۸ نویسه باشد.'
  else if (form.password.length > 128) errors.password = 'رمز عبور بیش از حد طولانی است.'

  if (isRegister.value) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) errors.email = 'ایمیل معتبر وارد کنید.'
    if (form.fullName.trim().length < 2 || form.fullName.trim().length > 100) errors.fullName = 'نام و نام خانوادگی باید بین ۲ تا ۱۰۰ نویسه باشد.'
    if (!/^\d{10}$/.test(normalizeDigits(form.nationalId))) errors.nationalId = 'کد ملی باید ۱۰ رقم باشد.'
    if (form.identityInfo.length > 500) errors.identityInfo = 'اطلاعات هویتی نباید بیشتر از ۵۰۰ نویسه باشد.'
  }
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

async function submit() {
  error.value = ''
  showRecoveryMessage.value = false
  if (busy.value || !validate()) return

  busy.value = true
  try {
    const endpoint = isRegister.value ? '/auth/register' : '/auth/login'
    const body = isRegister.value
      ? {
          username: form.username.trim(),
          password: form.password,
          email: form.email.trim(),
          fullName: form.fullName.trim(),
          nationalId: normalizeDigits(form.nationalId),
          identityInfo: form.identityInfo.trim(),
        }
      : { username: form.username.trim(), password: form.password }
    const { token } = await apiRequest(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    setSession(token, form.remember)
    await router.replace('/dashboard')
  } catch (requestError) {
    error.value = requestError.message
    fieldErrors.value = requestError.fields || {}
  } finally {
    busy.value = false
  }
}

// /login and /register share this component, so switching tabs must not carry the
// previous form's password or error messages into the other mode.
watch(() => props.mode, () => {
  error.value = ''
  fieldErrors.value = {}
  showRecoveryMessage.value = false
  form.password = ''
})
</script>

<template>
  <main class="auth-page">
    <div class="auth-shell">
      <header class="auth-brand">
        <AppBrand />
        <p>مدیریت یادداشت‌ها و وظایف شخصی</p>
      </header>

      <section class="auth-card">
        <nav class="auth-tabs" aria-label="ورود یا ثبت‌نام">
          <RouterLink to="/login" class="auth-tab" :class="{ 'auth-tab--active': !isRegister }" :aria-current="!isRegister ? 'page' : undefined">ورود به سیستم</RouterLink>
          <RouterLink to="/register" class="auth-tab" :class="{ 'auth-tab--active': isRegister }" :aria-current="isRegister ? 'page' : undefined">ثبت‌نام</RouterLink>
        </nav>

        <form class="auth-form" novalidate :aria-busy="busy" @submit.prevent="submit">
          <h1>{{ isRegister ? 'ایجاد حساب جدید' : 'خوش آمدید 👋' }}</h1>

          <label class="field">
            <span>نام کاربری</span>
            <span class="input-wrap">
              <UserRound class="field-icon" :size="18" aria-hidden="true" />
              <input
                v-model="form.username"
                dir="auto"
                autocomplete="username"
                maxlength="32"
                :placeholder="isRegister ? 'انتخاب نام کاربری' : 'نام کاربری خود را وارد کنید'"
                :aria-invalid="Boolean(fieldErrors.username)"
                :aria-describedby="fieldErrors.username ? 'username-error' : undefined"
                @input="clearFieldError('username')"
              />
            </span>
            <small v-if="fieldErrors.username" id="username-error" class="field-error">{{ fieldErrors.username }}</small>
          </label>

          <label class="field">
            <span>رمز عبور</span>
            <span class="input-wrap">
              <LockKeyhole class="field-icon" :size="18" aria-hidden="true" />
              <input
                v-model="form.password"
                type="password"
                maxlength="128"
                :autocomplete="isRegister ? 'new-password' : 'current-password'"
                :placeholder="isRegister ? 'حداقل ۸ کاراکتر' : 'رمز عبور خود را وارد کنید'"
                :aria-invalid="Boolean(fieldErrors.password)"
                :aria-describedby="fieldErrors.password ? 'password-error' : undefined"
                @input="clearFieldError('password')"
              />
            </span>
            <small v-if="fieldErrors.password" id="password-error" class="field-error">{{ fieldErrors.password }}</small>
          </label>

          <template v-if="isRegister">
            <label class="field">
              <span>ایمیل</span>
              <span class="input-wrap">
                <Mail class="field-icon" :size="18" aria-hidden="true" />
                <input
                  v-model="form.email"
                  dir="auto"
                  type="email"
                  autocomplete="email"
                  maxlength="254"
                  placeholder="example@email.com"
                  :aria-invalid="Boolean(fieldErrors.email)"
                  :aria-describedby="fieldErrors.email ? 'email-error' : undefined"
                  @input="clearFieldError('email')"
                />
              </span>
              <small v-if="fieldErrors.email" id="email-error" class="field-error">{{ fieldErrors.email }}</small>
            </label>

            <label class="field">
              <span>نام و نام خانوادگی</span>
              <span class="input-wrap">
                <UserRound class="field-icon" :size="18" aria-hidden="true" />
                <input
                  v-model="form.fullName"
                  dir="auto"
                  autocomplete="name"
                  maxlength="100"
                  placeholder="نام کامل خود را وارد کنید"
                  :aria-invalid="Boolean(fieldErrors.fullName)"
                  :aria-describedby="fieldErrors.fullName ? 'fullname-error' : undefined"
                  @input="clearFieldError('fullName')"
                />
              </span>
              <small v-if="fieldErrors.fullName" id="fullname-error" class="field-error">{{ fieldErrors.fullName }}</small>
            </label>

            <label class="field">
              <span>کد ملی</span>
              <span class="input-wrap">
                <CreditCard class="field-icon" :size="18" aria-hidden="true" />
                <input
                  v-model="form.nationalId"
                  inputmode="numeric"
                  autocomplete="off"
                  maxlength="10"
                  placeholder="۱۰ رقم"
                  :aria-invalid="Boolean(fieldErrors.nationalId)"
                  :aria-describedby="fieldErrors.nationalId ? 'national-id-error' : undefined"
                  @input="clearFieldError('nationalId')"
                />
              </span>
              <small v-if="fieldErrors.nationalId" id="national-id-error" class="field-error">{{ fieldErrors.nationalId }}</small>
            </label>

            <label class="field">
              <span>اطلاعات هویتی</span>
              <textarea
                v-model="form.identityInfo"
                rows="2"
                maxlength="500"
                placeholder="اطلاعات تکمیلی هویت..."
                :aria-invalid="Boolean(fieldErrors.identityInfo)"
                :aria-describedby="fieldErrors.identityInfo ? 'identity-info-error' : undefined"
                @input="clearFieldError('identityInfo')"
              />
              <small v-if="fieldErrors.identityInfo" id="identity-info-error" class="field-error">{{ fieldErrors.identityInfo }}</small>
            </label>
          </template>

          <div v-if="!isRegister" class="auth-options">
            <label class="remember-check"><input v-model="form.remember" type="checkbox" /> <span>مرا به خاطر بسپار</span></label>
            <button class="text-button" type="button" @click="showRecoveryMessage = true">فراموشی رمز</button>
          </div>

          <p v-if="showRecoveryMessage" class="form-message">بازیابی رمز عبور در این نسخهٔ محلی فعال نیست.</p>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>

          <button class="button button--primary auth-submit" type="submit" :disabled="busy">
            {{ busy ? 'لطفاً صبر کنید…' : isRegister ? 'ایجاد حساب' : 'ورود به سیستم' }}
          </button>

          <p v-if="!isRegister" class="auth-switch">حساب ندارید؟ <RouterLink to="/register">ثبت‌نام کنید</RouterLink></p>
        </form>
      </section>

      <footer class="auth-footer">© ۱۴۰۳ نوتیفای · تمامی حقوق محفوظ است</footer>
    </div>
  </main>
</template>
