<script setup>
import { FileText } from '../icons.js'

defineProps({
  compact: { type: Boolean, default: false },
})
</script>

<template>
  <div class="brand" :class="{ 'brand--compact': compact }">
    <span class="brand__mark"><FileText :size="21" :stroke-width="2.2" /></span>
    <span class="brand__name">نوتیفای</span>
  </div>
</template>
