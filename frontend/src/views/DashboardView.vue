<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { Check, Clock3, FileText, LogOut, Pencil, Plus, Search, Trash2 } from '../icons.js'
import AppBrand from '../components/AppBrand.vue'
import NoteModal from '../components/NoteModal.vue'
import { apiRequest, clearSession } from '../services/api.js'

const router = useRouter()
const notes = ref([])
const user = ref(null)
const search = ref('')
const loading = ref(true)
const saving = ref(false)
const busyNoteId = ref('')
const modalOpen = ref(false)
const editingNote = ref(null)
const pageError = ref('')
const saveError = ref('')
const toast = ref('')

const numberFormatter = new Intl.NumberFormat('fa-IR')
const dateFormatter = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: '2-digit', day: '2-digit' })

const filteredNotes = computed(() => {
  const query = search.value.trim().toLocaleLowerCase('fa')
  if (!query) return notes.value
  return notes.value.filter((note) => `${note.title} ${note.content} ${note.category}`.toLocaleLowerCase('fa').includes(query))
})
const completedCount = computed(() => notes.value.filter((note) => note.status === 'completed').length)
const activeCount = computed(() => notes.value.length - completedCount.value)
const completionRate = computed(() => notes.value.length ? Math.round((completedCount.value / notes.value.length) * 100) : 0)
const latestDate = computed(() => notes.value.reduce((latest, note) => {
  const time = new Date(note.updatedAt).getTime()
  return Number.isNaN(time) ? latest : Math.max(latest, time)
}, 0))

function formatNumber(value) {
  return numberFormatter.format(value)
}

function formatDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateFormatter.format(date)
}

// A stale 401 must send the user back to the form instead of leaving the page in
// a half-authenticated state where every action fails silently.
async function redirectIfUnauthorized(error) {
  if (error.status !== 401) return false
  clearSession()
  await router.replace('/login')
  return true
}

let loadSequence = 0
async function loadDashboard() {
  const sequence = ++loadSequence
  loading.value = true
  pageError.value = ''
  try {
    const [noteResult, userResult] = await Promise.all([
      apiRequest('/notes'),
      apiRequest('/auth/me'),
    ])
    if (sequence !== loadSequence) return
    notes.value = noteResult.notes
    user.value = userResult.user
  } catch (error) {
    if (sequence !== loadSequence) return
    if (await redirectIfUnauthorized(error)) return
    pageError.value = error.message
  } finally {
    if (sequence === loadSequence) loading.value = false
  }
}

function openCreate() {
  editingNote.value = null
  saveError.value = ''
  modalOpen.value = true
}

function openEdit(note) {
  editingNote.value = note
  saveError.value = ''
  modalOpen.value = true
}

let toastTimer
function notify(message) {
  window.clearTimeout(toastTimer)
  toast.value = message
  toastTimer = window.setTimeout(() => {
    toast.value = ''
  }, 2800)
}

function closeModal() {
  if (saving.value) return
  modalOpen.value = false
}

async function saveNote(form) {
  if (saving.value) return
  saving.value = true
  saveError.value = ''
  try {
    if (editingNote.value) {
      const { note } = await apiRequest(`/notes/${editingNote.value.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      notes.value = notes.value.map((item) => item.id === note.id ? note : item)
      notify('تغییرات یادداشت ذخیره شد.')
    } else {
      const { note } = await apiRequest('/notes', {
        method: 'POST',
        body: JSON.stringify(form),
      })
      notes.value = [note, ...notes.value]
      notify('یادداشت جدید ایجاد شد.')
    }
    modalOpen.value = false
  } catch (error) {
    if (await redirectIfUnauthorized(error)) return
    // Keep the dialog open so the message is visible next to the form.
    saveError.value = error.message
  } finally {
    saving.value = false
  }
}

async function deleteNote(note) {
  if (busyNoteId.value) return
  if (!window.confirm(`یادداشت «${note.title}» حذف شود؟`)) return
  busyNoteId.value = note.id
  try {
    await apiRequest(`/notes/${note.id}`, { method: 'DELETE' })
    notes.value = notes.value.filter((item) => item.id !== note.id)
    notify('یادداشت حذف شد.')
  } catch (error) {
    if (await redirectIfUnauthorized(error)) return
    pageError.value = error.message
  } finally {
    busyNoteId.value = ''
  }
}

async function logout() {
  clearSession()
  await router.replace('/login')
}

onMounted(loadDashboard)
onUnmounted(() => window.clearTimeout(toastTimer))
</script>

<template>
  <div class="dashboard-page">
    <header class="topbar">
      <AppBrand compact />
      <div class="topbar__actions">
        <span class="session-pill"><i aria-hidden="true" /> جلسه فعال</span>
        <span class="user-pill"><span class="avatar" aria-hidden="true">{{ user?.fullName?.trim()?.[0] || user?.username?.[0] || 'ن' }}</span><span>{{ user?.fullName || user?.username || 'کاربر' }}</span></span>
        <button class="logout-button" type="button" @click="logout"><LogOut :size="16" /> خروج</button>
      </div>
    </header>

    <main class="dashboard-main">
      <div class="page-heading">
        <h1>داشبورد یادداشت‌ها</h1>
        <p>مدیریت یادداشت‌ها و وظایف روزانه شما</p>
      </div>

      <section class="stats-grid" aria-label="آمار یادداشت‌ها">
        <article class="stat-card stat-card--total">
          <span class="stat-icon" aria-hidden="true"><FileText :size="22" /></span>
          <div><p>کل یادداشت‌ها</p><strong>{{ formatNumber(notes.length) }}</strong><small>تمام یادداشت‌های ثبت‌شده</small></div>
        </article>
        <article class="stat-card stat-card--done">
          <span class="stat-icon" aria-hidden="true"><Check :size="22" /></span>
          <div><p>انجام‌شده</p><strong>{{ formatNumber(completedCount) }}</strong><small>{{ formatNumber(completionRate) }}٪ از کل</small></div>
        </article>
        <article class="stat-card stat-card--active">
          <span class="stat-icon" aria-hidden="true"><Clock3 :size="22" /></span>
          <div><p>در دست انجام</p><strong>{{ formatNumber(activeCount) }}</strong><small>نیاز به توجه دارد</small></div>
        </article>
      </section>

      <section class="notes-panel" :aria-busy="loading">
        <div class="table-toolbar">
          <label class="search-field">
            <Search :size="18" aria-hidden="true" />
            <input v-model="search" type="search" placeholder="جستجو در یادداشت‌ها..." aria-label="جستجو در یادداشت‌ها" />
          </label>
          <button class="button button--primary add-note-button" type="button" @click="openCreate"><Plus :size="19" aria-hidden="true" /> افزودن یادداشت جدید</button>
        </div>

        <div v-if="pageError" class="page-alert" role="alert">
          <span>{{ pageError }}</span>
          <button type="button" @click="loadDashboard">تلاش دوباره</button>
        </div>

        <div class="table-scroll">
          <table class="notes-table">
            <thead>
              <tr>
                <th scope="col">عنوان یادداشت</th>
                <th scope="col">دسته‌بندی</th>
                <th scope="col">تاریخ ثبت</th>
                <th scope="col">وضعیت</th>
                <th scope="col">عملیات</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading"><td colspan="5" class="table-state">در حال بارگذاری یادداشت‌ها…</td></tr>
              <tr v-else-if="!filteredNotes.length"><td colspan="5" class="table-state">{{ search ? 'یادداشتی با این عبارت پیدا نشد.' : 'هنوز یادداشتی ندارید. اولین یادداشت خود را ایجاد کنید.' }}</td></tr>
              <template v-else>
                <tr v-for="note in filteredNotes" :key="note.id">
                  <td class="note-title" :title="note.content || note.title">{{ note.title }}</td>
                  <td><span class="category-pill">{{ note.category }}</span></td>
                  <td class="note-date">{{ formatDate(note.createdAt) }}</td>
                  <td><span class="status-pill" :class="note.status === 'completed' ? 'status-pill--done' : 'status-pill--active'"><i aria-hidden="true" />{{ note.status === 'completed' ? 'انجام‌شده' : 'فعال' }}</span></td>
                  <td>
                    <div class="row-actions">
                      <button class="row-button" type="button" :disabled="busyNoteId === note.id" @click="openEdit(note)"><Pencil :size="15" aria-hidden="true" /> ویرایش</button>
                      <button class="row-button" type="button" :disabled="busyNoteId === note.id" @click="deleteNote(note)"><Trash2 :size="15" aria-hidden="true" /> حذف</button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <footer class="table-footer">
          <span>نمایش {{ formatNumber(filteredNotes.length) }} از {{ formatNumber(notes.length) }} یادداشت</span>
          <span v-if="latestDate">آخرین بروزرسانی: {{ formatDate(latestDate) }}</span>
        </footer>
      </section>
    </main>

    <div v-if="toast" class="toast-message" role="status">{{ toast }}</div>
    <NoteModal v-if="modalOpen" :note="editingNote" :busy="saving" :error="saveError" @close="closeModal" @save="saveNote" />
  </div>
</template>
