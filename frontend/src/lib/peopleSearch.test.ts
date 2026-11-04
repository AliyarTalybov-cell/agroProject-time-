import { describe, expect, it } from 'vitest'
import { personInitials, searchPeople } from './peopleSearch'

const people = [
  { label: 'Алияр Талыбов', email: 'a@x.ru', sub: 'Главный агроном' },
  { label: 'Элла Васильева', email: 'ella@x.ru', sub: 'Инженер' },
  { label: 'Пётр Алексеев', email: 'petr@x.ru', sub: 'Механизатор' },
]

describe('searchPeople', () => {
  it('пустой запрос — никого не показывает, просит ввести', () => {
    const r = searchPeople(people, '  ')
    expect(r.items).toEqual([])
    expect(r.needQuery).toBe(true)
  })

  it('ищет по имени, email и должности, без учёта регистра и ё', () => {
    expect(searchPeople(people, 'элла').items.map((p) => p.label)).toEqual(['Элла Васильева'])
    expect(searchPeople(people, 'PETR@').items.map((p) => p.label)).toEqual(['Пётр Алексеев'])
    expect(searchPeople(people, 'петр').items.map((p) => p.label)).toEqual(['Пётр Алексеев'])
    expect(searchPeople(people, 'инженер').items.map((p) => p.label)).toEqual(['Элла Васильева'])
  })

  it('начало имени — выше совпадения внутри', () => {
    expect(searchPeople(people, 'ал').items.map((p) => p.label)).toEqual(['Алияр Талыбов', 'Пётр Алексеев'])
  })

  it('ограничивает выдачу и сообщает, сколько ещё', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ label: `Иван ${i}` }))
    const r = searchPeople(many, 'иван', 30)
    expect(r.items).toHaveLength(30)
    expect(r.more).toBe(20)
  })
})

describe('personInitials', () => {
  it('две буквы из имени и фамилии или из email', () => {
    expect(personInitials('Алияр Талыбов')).toBe('АТ')
    expect(personInitials('ella@x.ru')).toBe('EL')
  })
})
