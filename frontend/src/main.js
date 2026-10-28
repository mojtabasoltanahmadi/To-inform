import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import AuthView from './views/AuthView.vue'
import DashboardView from './views/DashboardView.vue'
import { hasSession } from './services/api.js'
import './styles.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/dashboard' },
    { path: '/login', component: AuthView, props: { mode: 'login' } },
    { path: '/register', component: AuthView, props: { mode: 'register' } },
    { path: '/dashboard', component: DashboardView },
    { path: '/:pathMatch(.*)*', redirect: '/dashboard' },
  ],
})

router.beforeEach((to) => {
  if (to.path === '/dashboard' && !hasSession()) return '/login'
  if ((to.path === '/login' || to.path === '/register') && hasSession()) return '/dashboard'
})

createApp(App).use(router).mount('#app')
