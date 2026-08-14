<template>
  <main class="rules-page">
    <section class="rules-card">
      <h1 class="rules-title">Условия тестового режима портала</h1>

      <div class="rules-block">
        <h2>О портале</h2>
        <p>
          Портал работает в тестовом режиме. Данные, которые вы вводите, используются только для проверки работы
          функций системы и не передаются третьим лицам.
        </p>
      </div>

      <div class="rules-block">
        <h2>Какие данные мы собираем</h2>
        <p>
          При регистрации вы указываете базовые данные (например: имя, email, пароль). При желании вы можете
          использовать вымышленные данные, если не хотите раскрывать личную информацию в тестовом контуре.
        </p>
      </div>

      <div class="rules-block">
        <h2>Право на удаление</h2>
        <p>
          Вы можете удалить свои данные в любой момент:
        </p>
        <ul>
          <li>Нажмите кнопку «Удалить аккаунт» в настройках профиля.</li>
          <li>
            Или напишите на
            <a href="mailto:aliyartalybov@icloud.com">aliyartalybov@icloud.com</a>,
            и данные будут удалены вручную в течение 24 часов.
          </li>
        </ul>
        <p>После удаления восстановить записи будет невозможно.</p>
      </div>

      <div class="rules-block">
        <h2>Согласие</h2>
        <p>
          Продолжая использовать портал, вы подтверждаете, что ознакомлены с условиями тестового режима
          и согласны с обработкой данных в рамках этих условий.
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.rules-page {
  min-height: 100vh;
  padding: 24px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--bg-body);
}

.rules-card {
  width: min(920px, 100%);
  background: var(--bg-panel);
  border: 1px solid var(--border-color);
  border-radius: 14px;
  box-shadow: var(--shadow-card);
  padding: clamp(20px, 4vw, 34px);
}

.rules-title {
  margin: 0 0 18px;
  font-size: clamp(1.35rem, 2.6vw, 1.8rem);
  color: var(--text-primary);
}

.rules-block + .rules-block {
  margin-top: 16px;
}

.rules-block h2 {
  margin: 0 0 8px;
  font-size: 1rem;
  color: var(--text-primary);
}

.rules-block p {
  margin: 0;
  line-height: 1.6;
  color: var(--text-secondary);
}

.rules-block ul {
  margin: 8px 0;
  padding-left: 18px;
  color: var(--text-secondary);
}

.rules-block li + li {
  margin-top: 6px;
}

.rules-block a {
  color: var(--accent-green);
}
</style>
