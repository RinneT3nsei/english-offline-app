# 🇬🇧 Offline English — Android додаток для вивчення лексики

<p align="center">
  <img src="https://img.shields.io/badge/Platform-Android-3DDC84?style=for-the-badge&logo=android&logoColor=white" alt="Android">
  <img src="https://img.shields.io/badge/Capacitor-7.0-119EFF?style=for-the-badge&logo=capacitor&logoColor=white" alt="Capacitor 7">
  <img src="https://img.shields.io/badge/Engine-Piper_TTS_INT8-FF6F00?style=for-the-badge&logo=onnx&logoColor=white" alt="Piper TTS ONNX">
  <img src="https://img.shields.io/badge/UI-Google_Material_3-4285F4?style=for-the-badge&logo=google&logoColor=white" alt="Material 3">
  <img src="https://img.shields.io/badge/Offline-100%25-059669?style=for-the-badge" alt="100% Offline">
</p>

**Offline English** — це автономний високопродуктивний мобільний застосунок для вивчення англійських слів та контекстних фраз, розроблений за стандартами **Google Material Design 3 (Material You)**.

Головна мета застосунку — надати швидкий, зручний і **100% незалежний від інтернету** інструмент для поповнення словникового запасу з автентичною британською та американською нейронною вимовою.

---

## 🌟 Ключові можливості (Features)

### 🔊 Локальний нейронний синтез мовлення (Piper Neural TTS INT8)
- **Повна автономність**: жодних викликів хмарних API та жодних залежностей від встановлених у системі Android голосових пакетів.
- **Подвійна вимова на рівні кожної картки**:
  - 🇺🇸 **US Accent** (голосова нейромодель *Lessac Medium INT8*).
  - 🇬🇧 **UK Accent** (голосова нейромодель *Alan Medium INT8*).
- **Окреме озвучення**: незалежні компактні кнопки вимови для заголовного слова та для розгорнутого контекстного речення.
- **Оптимізація та швидкість**: квантовані 8-бітні ваги моделей (~17.7 МБ кожна) виконуються безпосередньо у WebView через **ONNX Runtime WebAssembly SIMD** та відтворюються через **Web Audio API** з мікросекундною затримкою.
- **Надійний трирівневий фоллбек**: Piper WASM → `@capacitor-community/text-to-speech` → `window.speechSynthesis`.

### 🎨 Інтерфейс Google Material You (Material 3)
- **Дворівнева архітектура хедера**:
  - **Верхній бар**: логотип і статус, які природно йдуть угору під час скролу.
  - **Compact Sticky App Bar**: закріплений рядок живого пошуку та чіпи категорій із ефектом матового скла (`backdrop-filter: blur(20px)`), що плавно пропускає картки під себе.
- **Плаваючий FAB тренування (Floating Action Button)**:
  - Зручна овальна кнопка `⚡ Тренування` у правому нижньому кутку екрана (`position: fixed; z-index: 999;`).
  - Миттєвий перехід у режим самоперевірки (приховування українського перекладу м'яким розмиттям).
  - Тап по перекладу відкриває відповідь для самоконтролю.
- **Функція "Обране" (⭐ Favorites)**:
  - Додавання карток до обраного в один дотик із збереженням у `localStorage`.
  - Динамічний лічильник збережених слів та швидкий фільтр у списку чіпів.
- **Ергономіка та безпечні зони**: повна підтримка відступів під вирізи камер і жести керування (`env(safe-area-inset-*)`).

---

## 🏗️ Архітектура та технічний стек

| Рівень | Технології | Опис |
| :--- | :--- | :--- |
| **Frontend** | Pure HTML5, CSS3, ES6+ JavaScript | Повна відсутність зовнішніх важких фреймворків, CDN або веб-шрифтів. Чистий швидкий рендеринг. |
| **Mobile Runtime** | **Capacitor 7.0** (`@capacitor/android`) | Сучасний нативний міст для упаковки веб-додатку в Android APK з підтримкою Android 14+ та сучасних WebView API. |
| **TTS Plugins** | `@capacitor-community/text-to-speech: ^6.1.0` | Нативний плагін синтезу мови як надійний рівень сумісності. |
| **Neural TTS** | **Piper TTS** + **ONNX Runtime Web** (`ort-wasm-simd.wasm`) | Локальні квантовані моделі `en_US-lessac-medium.onnx` та `en_GB-alan-medium.onnx`. |
| **Audio Pipeline** | Web Audio API (`AudioContext`, `AudioBufferSourceNode`) | Апаратне мікшування та безшовна черга аудіофрагментів. |
| **База знань** | `www/assets/dictionary.json` | 55+ структурованих словникових карток рівнів B1–C2 з частинами мови, IPA-фонетикою та паралельним перекладом. |
| **CI / CD** | **GitHub Actions** (`ubuntu-latest`, Node 24, Zulu JDK 21) | Автоматизована хмарна компіляція готового до встановлення Debug APK. |

---

## 📂 Структура репозиторію

```text
├── .github/
│   └── workflows/
│       └── build-apk.yml           # CI/CD пайплайн збірки Android APK
├── www/                            # Вихідний код клієнтського застосунку
│   ├── index.html                  # Семантична розмітка Material 3 (Sticky Bar + FAB)
│   ├── style.css                   # OLED Dark тема, Material 3 палітра, анімації
│   ├── app.js                      # Пошук, фільтри, Piper WASM аудіорушій
│   └── assets/
│       ├── dictionary.json         # Локальна база словникових статей B1–C2
│       └── tts/                    # Нейронні моделі та WebAssembly бінарники
│           ├── en_US-lessac-medium.onnx        # Модель US акценту (INT8, ~17.7 MB)
│           ├── en_US-lessac-medium.onnx.json   # Конфігурація фонетизатора US
│           ├── en_GB-alan-medium.onnx          # Модель UK акценту (INT8, ~17.8 MB)
│           ├── en_GB-alan-medium.onnx.json     # Конфігурація фонетизатора UK
│           ├── ort.min.js                      # ONNX Runtime Web лоадер
│           ├── ort-wasm-simd.wasm              # Оптимізоване SIMD ядро
│           └── ort-wasm.wasm                   # Стандартне WASM ядро
├── capacitor.config.json           # Конфігурація Android обгортки (com.offline.english)
├── package.json                    # Маніфест залежностей Capacitor 7
├── .gitattributes                  # Конфігурація Git LFS для моделей та wasm
└── README.md                       # Технічна документація проєкту
```

---

## 🚀 Швидкий старт та локальна розробка

### 1. Перегляд інтерфейсу у браузері
Веб-додаток є повністю статичним. Для перевірки та тестування достатньо запустити будь-який локальний HTTP-сервер у папці `www/`:
```bash
# Використання npx serve або python http.server
npx serve www
# або
python -m http.server 8080 --directory www
```
> Відкрийте `http://localhost:8080` у браузері з підтримкою WebAssembly.

---

### 2. Локальна збірка під Android

Вимоги:
- **Node.js**: v20+ або v24 LTS
- **JDK**: Java 21 (рекомендовано Azul Zulu JDK 21)
- **Android Studio** з встановленими Android SDK Platform 34/35 та Build-Tools.

Порядок команд:
```bash
# 1. Встановлення залежностей проєкту
npm install

# 2. Додавання платформи Android (створює каталог android/)
npx cap add android

# 3. Синхронізація веб-файлів www/ та плагінів у нативний проєкт
npx cap sync android

# 4. Відкриття проєкту в Android Studio
npx cap open android
```

Збірка APK напряму через термінал:
```bash
cd android
chmod +x gradlew
./gradlew assembleDebug
```
Готовий файл з'явиться за шляхом:
`android/app/build/outputs/apk/debug/app-debug.apk`

---

## 🤖 Автоматична збірка APK через GitHub Actions

У проєкті налаштовано робочий пайплайн [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml):

1. Зробіть `git push` ваших змін у гілку `main` (або запустіть вручну через вкладку **Actions** → **Run workflow**).
2. GitHub Actions автоматично:
   - Розгорне віртуальне середовище на базі `ubuntu-latest`.
   - Завантажить бінарні моделі через **Git LFS** (`actions/checkout@v5`).
   - Налаштує Java 21 (`actions/setup-java@v5`) та Node.js 24 (`actions/setup-node@v5`).
   - Синхронізує платформу Capacitor (`npx cap add android` + `npx cap sync android`).
   - Збере готовий налагоджувальний пакет через `./gradlew assembleDebug`.
   - Опублікує артефакт через `actions/upload-artifact@v5`.
3. Завантажте зібраний файл **OfflineEnglish-Debug** у розділі **Artifacts** поточного запуску та встановіть його на свій Android-пристрій.

---

## 📄 Ліцензія

Проєкт поширюється під ліцензією [MIT](package.json). Використані моделі Piper TTS ліцензовані авторами згідно з відповідними відкритими ліцензіями Hugging Face / Rhasspy.
