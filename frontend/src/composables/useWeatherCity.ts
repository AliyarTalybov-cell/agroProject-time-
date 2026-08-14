import { ref, watch, onMounted } from 'vue'
import { DEFAULT_CITY_VALUE } from '@/lib/cities'

const STORAGE_KEY = 'agro:weatherCity'

function getStoredCity(): string {
  if (typeof localStorage === 'undefined') return DEFAULT_CITY_VALUE
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored || DEFAULT_CITY_VALUE
}

const cityValue = ref(getStoredCity())

export function useWeatherCity() {
  onMounted(() => {
    cityValue.value = getStoredCity()
  })

  watch(cityValue, (next) => {
    localStorage.setItem(STORAGE_KEY, next)
  })

  function setCity(value: string) {
    cityValue.value = value
  }

  return {
    cityValue,
    setCity,
    city: () => cityValue.value.split(',')[0],
    country: () => cityValue.value.split(',')[1] || 'ru',
  }
}
