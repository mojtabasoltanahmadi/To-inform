<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { X } from '../icons.js'

const props = defineProps({
  note: { type: Object, default: null },
  busy: { type: Boolean, default: false },
  error: { type: String, default: '' },
})
const emit = defineEmits(['close', 'save'])
const isEditing = computed(() => Boolean(props.note))
const form = reactive({
  title: props.note?.title || '',
  content: props.note?.content || '',
  category: props.note?.category || 'کاری',
  status: props.note?.status || 'active',
})
const fieldErrors = ref({})
const dialog = ref(null)
const titleInput = ref(null)
let previouslyFocused = null

const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

function close() {
  if (props.busy) return
  emit('close')
}

function validate() {
  const errors = {}
  const title = form.title.trim()
  if (!title) errors.title = 'عنوان یادداشت را وارد کنید.'
  else if (title.length > 120) errors.title = 'عنوان یادداشت حداکثر ۱۲۰ نویسه است.'
  if (form.content.length > 2000) errors.content = 'توضیحات نباید بیشتر از ۲۰۰۰ نویسه باشد.'
  fieldErrors.value = errors
  return Object.keys(errors).length === 0
}

function submit() {
  // The dialog stays mounted during a failed save, so block repeated submits here.
  if (props.busy) return
  if (!validate()) return
  emit('save', {
    title: form.title.trim(),
    content: form.content.trim(),
    category: form.category,
    status: form.status,
  })
}

function onKeydown(event) {
  if (event.key === 'Escape') {
    close()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = Array.from(dialog.value.querySelectorAll(focusableSelector))
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

onMounted(async () => {
  previouslyFocused = document.activeElement
  window.addEventListener('keydown', onKeydown)
  await nextTick()
  titleInput.value?.focus()
  titleInput.value?.select()
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown)
  if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) previouslyFocused.focus()
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @mousedown.self="close">
      <section ref="dialog" class="note-modal" role="dialog" aria-modal="true" :aria-labelledby="isEditing ? 'edit-note-title' : 'new-note-title'">
        <header class="modal-header">
          <div>
            <h2 :id="isEditing ? 'edit-note-title' : 'new-note-title'">{{ isEditing ? 'ویرایش یادداشت' : 'ایجاد یادداشت جدید' }}</h2>
            <p>{{ isEditing ? 'اطلاعات یادداشت را ویرایش کنید' : 'فیلدهای زیر را تکمیل کنید' }}</p>
          </div>
          <button class="icon-button modal-close" type="button" aria-label="بستن" :disabled="busy" @click="close"><X :size="20" /></button>
        </header>

        <form class="note-form" novalidate @submit.prevent="submit">
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>

          <label class="field">
            <span>عنوان یادداشت <b class="required" aria-hidden="true">*</b></span>
            <input
              ref="titleInput"
              v-model="form.title"
              maxlength="120"
              required
              aria-required="true"
              placeholder="عنوان یادداشت را بنویسید..."
              :aria-invalid="Boolean(fieldErrors.title)"
              :aria-describedby="fieldErrors.title ? 'note-title-error' : undefined"
            />
            <small v-if="fieldErrors.title" id="note-title-error" class="field-error">{{ fieldErrors.title }}</small>
          </label>

          <label class="field">
            <span>توضیحات</span>
            <textarea
              v-model="form.content"
              rows="3"
              maxlength="2000"
              placeholder="توضیحات بیشتر (اختیاری)..."
              :aria-invalid="Boolean(fieldErrors.content)"
              :aria-describedby="fieldErrors.content ? 'note-content-error' : undefined"
            />
            <small v-if="fieldErrors.content" id="note-content-error" class="field-error">{{ fieldErrors.content }}</small>
          </label>

          <div class="form-row">
            <label class="field">
              <span>دسته‌بندی</span>
              <select v-model="form.category">
                <option>کاری</option>
                <option>پروژه</option>
                <option>شخصی</option>
                <option>آموزش</option>
                <option>مالی</option>
              </select>
            </label>
            <label class="field">
              <span>وضعیت</span>
              <select v-model="form.status">
                <option value="active">فعال</option>
                <option value="completed">انجام‌شده</option>
              </select>
            </label>
          </div>

          <div class="modal-actions">
            <button class="button button--primary" type="submit" :disabled="busy">{{ busy ? 'در حال ذخیره…' : isEditing ? 'ذخیره تغییرات' : 'ایجاد یادداشت' }}</button>
            <button class="button button--muted" type="button" :disabled="busy" @click="close">انصراف</button>
          </div>
        </form>
      </section>
    </div>
  </Teleport>
</template>
