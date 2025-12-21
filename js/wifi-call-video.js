const body = document.querySelector('body');
const bodyHeightStart = body.clientHeight; // слепок высоты экрана
const app = document.querySelector('.app');
const usersOnline = document.querySelector('#users-online');
const menuButton = document.querySelector('.app-menu-button');
const appReadBlock = document.querySelector('.app-read-block');
const allBlackScreens = document.querySelectorAll('.black-screen');
const badReportBlackScreen = document.querySelector('#bad-report-black-screen');
const goodReportBlackScreen = document.querySelector('#good-report-black-screen');
const menuLinks = document.querySelectorAll('.menu__link');
const reportListItems = document.querySelectorAll('.report-list__item');
const appMessage = document.querySelector('.app-message');
const appMessageCloseButton = document.querySelector('.app-message__close-button');

const templateGoodReport = document.querySelector('#template-good-report');
const templateBadReport = document.querySelector('#template-bad-report');

const soundCall = new Audio('./sound/call-iphone.mp3');

let clientId; // твой id (socket.io)
let partnerId; // id собеседника (socket.io)
let partnerNumber = ''; // номер собеседника (инициатора / звонящего)
let nickname = '';
// let partnerNickname = '';
let isReportCurrentDialog = false; // жаловался ли ты в текущем диалоге (нужно для показа report в послед. activity)
let isInitiator; // инициатора (offer) или нет (answer) - решает сервер
let peer; // здесь будет объект SimplePeer
let webRTCConnected = false;
let isWiFiCallBusy = false; // если клиент уже занят разговором
let enableSound = true; // включён звук (голос и другие звуковые уведомления) всегда включать в конце разговора

// для таймера диалога
let timerIntervalId;
let elapsedSeconds = 0;

// для видео
let localStream = null;
let isVideoEnabled = false;
let hasVideoCapability = false;

// localStorage.clear();

const codeReportList = {
  '1': {type: 'good', text: 'приятное общение'},
  '2': {type: 'good', text: 'красивый голос'},
  '3': {type: 'good', text: 'умный собеседник'},
  '4': {type: 'good', text: 'просто няшка'},
  '5': {type: 'bad', text: 'токсичное поведение'},
  '6': {type: 'bad', text: 'шумная компания'},
  '7': {type: 'bad', text: 'молчание'},
  '8': {type: 'bad', text: 'реклама и спам'},
};

/* localStorage{latsActive, 'reports', isBan, banCode, banType, banDate} */

// функция вернёт сегодняшнюю дату со временем
function getDateTimeNow() {
  const now = new Date();
  return now.toLocaleString('en-CA', { // Локаль en-CA для формата Y-m-d
    hour12: false, // Используем 24-часовой формат
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(',', ''); // Убираем запятую между датой и временем
}

// функция вернёт сегодняшнюю дату без времени
function getDateNow() {
  return new Date().toLocaleDateString('en-CA'); // Формат YYYY-MM-DD для локальной зоны
}

// функция к текущей дате и времени прибавит нужное количество минут
function getFullDatePlusMinutes(addMinutes) {
  const now = new Date();
  now.setMinutes(now.getMinutes() + addMinutes); // Добавляем 30 минут
  
  return now.toLocaleString('en-CA', { // Локаль en-CA для формата Y-m-d
    hour12: false, // Используем 24-часовой формат
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).replace(',', ''); // Убираем запятую между датой и временем
}

// функция установит ключи и начальные значения, если таких ключей не было
function initializeLocalStorage(defaults) { // на вход подаётся объект с ключами и значениями
  // {lastActive: new Date().toISOString(), isBan: false, banType: null, banDate: null}
  if (typeof defaults !== 'object' || defaults === null) {
    console.error('Параметр должен быть объектом с ключами и значениями по умолчанию.');
    return;
  }

  for (const [key, value] of Object.entries(defaults)) {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify(value));
      // console.log(`ключа: ${key} в localStorage не было`);
    }
  }
}

// функция изменит данные по лючу в localStorage
function updateLocalStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// Создадим в localStorage объект для хранения жалоб. Он будет содержать ключи с кодами жалоб и счётчик для каждого кода.
function initReportsStorage() {
  if (!localStorage.getItem('reports')) {
    const initialReports = Object.keys(codeReportList).reduce((newObj, code) => {
      newObj[code] = 0; // Устанавливаем счётчик для каждого кода на 0
      return newObj;
    }, {});
    localStorage.setItem('reports', JSON.stringify(initialReports));
  } else {
    // Загружаем существующие данные из localStorage
    let reports = JSON.parse(localStorage.getItem('reports')) || {};

    // Добавляем новые ключи из codeReportList, если их нет
    Object.keys(codeReportList).forEach((code) => {
      if (!(code in reports)) {
        reports[code] = 0; // Устанавливаем значение по умолчанию
      }
    });

    // Удаляем ключи из reports, которых больше нет в codeReportList
    Object.keys(reports).forEach((code) => {
      if (!(code in codeReportList)) {
        delete reports[code];
      }
    });

    // Сохраняем обновлённый объект в localStorage
    localStorage.setItem('reports', JSON.stringify(reports));
  }
}

// Функция для увеличения счётчика жалобы по конкретному коду
function incrementReport(code) {
  const reports = JSON.parse(localStorage.getItem('reports'));
  if (reports && reports[code] !== undefined) {
    reports[code] += 1;
    localStorage.setItem('reports', JSON.stringify(reports));
    console.log(`Жалоба с кодом ${code} увеличена до ${reports[code]}`);
  }
}

// Функция для получения текущего значения счётчика для определённого кода
function getReportCountByCode(code) {
  const reports = JSON.parse(localStorage.getItem('reports'));
  return reports && reports[code] !== undefined ? reports[code] : null;
}

// Проверка блокировки
function checkIsBan() {
  return JSON.parse(localStorage.getItem('isBan'));
}

// Функции таймера диалога
function startTimer() {
  timerIntervalId = setInterval(() => {
      elapsedSeconds++;
      document.querySelector('.dialog-data__timer').textContent = formatTime(elapsedSeconds);
  }, 1000);
}

function stopTimer() {
  clearInterval(timerIntervalId);
  timerIntervalId = null; // Обнуляем переменную, чтобы можно было заново стартовать
  elapsedSeconds = 0;
}

function formatTime(seconds) {
  const hours = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const minutes = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

// обработчики события закрытия для каждого чёрного экрана
allBlackScreens.forEach((blackScreen) => {
  blackScreen.addEventListener('click', (event) => {
    const element = event.target;
    if (element.matches('.black-screen__close-button')) {
      closeBlackScreen(blackScreen);
    }
  });
});

// открыть чёрный экран
function openBlackScreen(screen) {
  screen.classList.add('black-screen_active');
}

// закрыть чёрный экран
function closeBlackScreen(screen) {
  screen.classList.remove('black-screen_active');
}

menuButton.addEventListener('click', () => {
  appReadBlock.classList.toggle('app-read-block_active');
});

reportListItems.forEach((reportButon) => {
  reportButon.addEventListener('click', () => {
    if (!isReportCurrentDialog) {
      const reportDescription = reportButon.querySelector('.report-list__item-description');
      if (reportDescription && reportDescription.hasAttribute('code')) {
        const reportCode = reportDescription.getAttribute('code');
        // console.log(`reportCode: ${reportCode}`);

        // ограничение количества репортов
        let isCanBadReport = true;
        const reportType = codeReportList[reportCode].type;
        updateLocalStorage('reportCount', JSON.parse(localStorage.getItem('reportCount')) + 1);
        if (reportType === 'bad' && JSON.parse(localStorage.getItem('reportCount')) > MAX_COUNT_REPORT) {
          isCanBadReport = false;
        }
        
        // отправим репорт на сервер если есть на кого и не превышен лимит жалоб
        if (partnerId && isCanBadReport) {
          socket.emit('reportCode', { reportCode: reportCode, partnerId: partnerId });
        } else {
          console.log('Жалоба не отправлена');
        }

        // закрываем чёрный экран
        const reportOfBlackScreen = reportButon.closest('.black-screen');
        if (reportOfBlackScreen) {
          closeBlackScreen(reportOfBlackScreen);
        }

        // разрываем webrtc-соединение
        if (peer) {
          peer.destroy();
          peer = null;
        }

        // сообщаем другому собеседнику о завершении диалога
        if (partnerId) {
          socket.emit('stopDialog', {type: 'voiceRoulette', partnerId: partnerId});
        }

        // отмечаем, что в текущем диалоге уже был report
        isReportCurrentDialog = true;

        // смена activity
        stopDialogActivity();
      }
    }
  });
});

// функция откроет app-message
function openAppMessage() {
  appMessage.classList.add('app-message_active');
}

// функция закроет app-message
function closeAppMessage() {
  appMessage.classList.remove('app-message_active');
}

appMessageCloseButton.addEventListener('click', () => {
  closeAppMessage();
});

function createAppMessage(titleText, messageText) {
  const appMessageTitle = appMessage.querySelector('.app-message__close-title');
  const appMessageText = appMessage.querySelector('.app-screen__text-box');
  appMessageTitle.textContent = titleText;
  appMessageText.innerHTML = messageText;

  openAppMessage();
}

function dialogShowPartner() {
  const dialogDetail = document.querySelector('.dialog-data__detail');
  dialogDetail.classList.add('dialog-data__detail_active');
}

function dialogPeerStatus(text) {
  const connectInfo = document.querySelector('.dialog-data__connect-info');
  connectInfo.innerHTML = text;
  //connectInfo.textContent = text;
}

// функция вставит временный номер для копирования и отправки ссылки
function insertTempNumber() {
  // вставим временный номер
  const yourNumber = document.querySelector('#your-number');
  if (yourNumber) {
    yourNumber.textContent = clientId;

    const yourNumberDescription = document.querySelector('.your-number-block__description');
    yourNumberDescription.textContent = '(кликните чтобы скопировать и передайте собеседнику)';
  }
}

// функция будет проверять состояние активности микрофона собеседника
function checkPartnerMicrophone(microphone) {
  const connectInfo = document.querySelector('.dialog-data__connect-info');
  if (!microphone) { // false
    connectInfo.textContent = 'собеседник отключил микрофон';
  } else { // true
    connectInfo.textContent = '';
  }
}

// Функция для захвата аудио с устройства ------------------------------------------------------------------
let microphoneEnabled = true; // текущее состояние микрофона (нужно всегда включать при новом разговоре или в конце)
let audioTracks; // глобальные аудиотреки для работы ниже (вкл / выкл микрофон)
// ЗАМЕНИТЕ существующую функцию getAudioStream на эту:
async function getMediaStream() {
  try {
    // Всегда запрашиваем и аудио, и видео
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: false,
      },
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24 }
      }
    });
    
    audioTracks = stream; // сохраняем для управления микрофоном
    localStream = stream; // сохраняем глобально
    
    // Изначально выключаем видео
    localStream.getVideoTracks().forEach(track => {
      track.enabled = false;
    });
    
    isVideoEnabled = false;
    hasVideoCapability = true;
    
    return stream;
  } catch (error) {
    console.error("Ошибка получения медиа-потока:", error);
    
    // Если видео недоступно, пробуем только аудио
    try {
      const audioOnlyStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        }
      });
      
      audioTracks = audioOnlyStream;
      localStream = audioOnlyStream;
      hasVideoCapability = false;
      
      return audioOnlyStream;
    } catch (audioError) {
      console.error("Ошибка получения аудио:", audioError);
      throw audioError;
    }
  }
}

// Подключаемся к серверу через socket.io
// const socket = io('http://localhost:3001');
// const socket = io('https://587817838321.vps.myjino.ru/call');
const socket = io('https://587817838321.vps.myjino.ru', {
  path: '/call/socket.io',
  transports: ['websocket', 'polling']
});


// Уведомление о первом / новом подключении
socket.on('firstConnect', (data) => {
  clientId = data.message; // присваиваем тебе id в переменную
  // console.log('Соединились с сервером');
  if (webRTCConnected) { // если есть активное webRTC соединение (был разрыв с сервером)
    // console.log('peer соединение активно!');
    peer.send(JSON.stringify({type: 'newWebSocket', newWebSocket: clientId}));
  }
  insertTempNumber();
});

// слушатель users-online
socket.on('usersOnline', (data) => {
  usersOnline.textContent = data.usersOnline;
});

// сообщение от сервера о входящем WiFi вызове
socket.on('incomingWifiCall', (data) => {
  if (!isWiFiCallBusy) { // если поступает звонок и клиент не занят другим разговором
    partnerNumber = data.initiatorId;
    // console.log(`Входящий вызов! Инициатор: ${partnerNumber}`);
    sendCallActivity(); // вызываем активити с входящим вызовом (ответить / отклонить)
    soundCall.play(); // запускаем звук вызова
  } else { // если клиент уже занят разговором
    // отклонить звонок и через сервер передать сообщение, что занят
    // отправим через сервер уведомление инициатору о том, что ожидающий отклонил звонок
    socket.emit('declineWifiCall', {partnerNumber: data.initiatorId});
    console.log('звонит 3-й');
  }
});

// сообщение о том, что собеседник найден
socket.on('matchFound', (data) => {
  partnerId = data.partnerId;
  isInitiator = data.isInitiator;
  dialogActivity(data.partnerName);
  dialogPeerStatus('подключение..');

  // webrtc -----
  // Инициализация SimplePeer с медиа потоком
  getMediaStream().then(stream => {
    if (!stream) {
      throw new Error("Не удалось получить медиа поток.");
    }
    peer = new SimplePeer({
      initiator: isInitiator,
      trickle: true,
      stream: stream,  // Передаём поток (аудио + потенциальное видео)
      config: {
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
          { urls: "stun:stun3.l.google.com:19302" },
          { urls: "stun:stun4.l.google.com:19302" },
          { urls: "stun:stun.qq.com:3478" },
          { urls: "stun:stun.miwifi.com:3478" },
          { urls: "stun:stun.nextcloud.com:443" },
          { urls: "stun:stun.voipgate.com:3478" },
          { urls: 'stun:global.stun.twilio.com:3478' },
          {
            urls: 'turn:numb.viagenie.ca',
            username: 'webrtc@live.com',
            credential: 'muazkh'
          }
        ]
      }
    });

    // Когда соединение установлено
    peer.on('connect', () => {
      dialogShowPartner();
      dialogPeerStatus('');
      startTimer();
      webRTCConnected = true;
    });

    // Получение сигнала SDP
    peer.on('signal', (signalData) => {
      socket.emit('signal', { signal: signalData, partnerId: partnerId });
    });

    // Получение медиа потока от партнёра
    peer.on('stream', (partnerStream) => {
      // Аудио
      let audio = document.querySelector('audio.partner-stream');
      if (!audio) {
        audio = document.createElement('audio');
        audio.classList.add('partner-stream');
        document.body.appendChild(audio);
      }
      audio.srcObject = partnerStream;
      audio.play();
      
      // Видео партнёра
      let partnerVideo = document.querySelector('#partner-video');
      if (!partnerVideo) {
        partnerVideo = document.createElement('video');
        partnerVideo.id = 'partner-video';
        partnerVideo.autoplay = true;
        partnerVideo.playsinline = true;
        partnerVideo.classList.add('partner-video');
        
        const videoBox = document.querySelector('.video-box');
        if (videoBox) {
          videoBox.insertBefore(partnerVideo, videoBox.firstChild);
        }
      }
      partnerVideo.srcObject = partnerStream;
    });

    // Обработка получения данных (сообщений) через dataChannel
    peer.on('data', (message) => {
      const data = JSON.parse(message);

      if (data.type === 'newWebSocket') {
        partnerId = data.newWebSocket;
      }

      if (data.type === 'partnerMicrophone') {
        checkPartnerMicrophone(data.partnerMicrophone);
      }
      
      // Обработка состояния видео партнёра
      if (data.type === 'videoState') {
        updatePartnerVideoState(data.videoEnabled);
      }
    });

    peer.on('error', (error) => {
      console.log(`ошибка в webRTC: ${error}`);
      dialogPeerStatus('неполадки');
    });

    peer.on('close', () => {
      stopDialogActivity();
    });

  }).catch((err) => {
    console.error('Ошибка доступа к медиа устройствам:', err);
  });
});

// Обработка сигнала от партнёра (SDP или ICE-кандидат)
socket.on('signal', (data) => {
  setTimeout(() => {
    peer.signal(data.signal);  // Отправляем сигнал от партнёра
  }, 500);
  // peer.signal(data.signal);  // Отправляем сигнал от партнёра
});

// Поступил Report
socket.on('reportCode', (data) => {
  // console.log(`Пришёл код жалобы: ${data.reportCode}`);
  incrementReport(data.reportCode);
  const countReportByCode = getReportCountByCode(data.reportCode);
  // console.log(`На тебя отправили report с кодом ${data.reportCode}, всего: ${countReportByCode}`);
  const reportType = codeReportList[data.reportCode]['type'];
  const reportText = codeReportList[data.reportCode]['text'];

  if (reportType === 'good') {
    const title = '🙂 комплимент';
    const message = `<p class="text-box__p text-box__p_center">Собеседники делают вам комплименты типа: <span class="text-color_red">${reportText}</span></p>`;
    createAppMessage(title, message);
    // console.log(`на вас поступают лайки типа: ${reportText}`);
  } else if (reportType === 'bad') {
    if (countReportByCode >= REPORT_VALUE_MESSAGE && countReportByCode < REPORT_VALUE_BAN) {
      const title = '🤯 печалька';
      const message = `<p class="text-box__p text-box__p_center">Собеседники недовольны вашим поведением типа: <span class="text-color_red">${reportText}</span></p>`;
      createAppMessage(title, message);
      //console.log(`на вас поступают жалобы типа: ${reportText}`);
    } else if (countReportByCode >= REPORT_VALUE_BAN) {
      updateLocalStorage('isBan', true); // установим isBan
      updateLocalStorage('banCode', data.reportCode);
      updateLocalStorage('banDate', getFullDatePlusMinutes(BAN_MINUTES));
    }
  }
});

// Получаем событие завершения диалога собеседником
socket.on('stopDialog', (data) => {
  if (data.message === 'stopDialog') {
    peer.destroy(); // разрываем webrtc-соединение
    peer = null;
    stopDialogActivity(); // сменить activity
    // console.log('Собеседник завершил диалог');
  }
});

// Получаем от сервера событие о том, что ожидающий отклонил звонок
socket.on('declineWifiCall', () => {
  console.log('Ожидающий отклонил вызов');
  stopDialogActivity();
});

// получаем от сервера событие о том, что инициатор отменил звонок в момент вызова
socket.on('initiatorDeclineWifiCall', () => {
  // отключаем звук
  soundCall.pause();
  soundCall.currentTime = 0;

  // покажем ожидающему активити с завершением диалога
  stopDialogActivity();
});

// получаем от сервера событие о том, что у ожидающего обновилась session.id и даём уведомление
socket.on('wifi-call_new-session', () => {
  startActivity(false);
});


/* // слушаем app и делегируем события input
app.addEventListener('input', (event) => {
  if (event.target.matches('.input-username')) {
    handleInputUsername(event);
  }
}); */

// слушаем app и делегируем события click
app.addEventListener('click', (event) => {
  if (event.target.matches('.wifi-call-button')) { // если клиент послал звонок другому клиенту
    // // получаем session.id из input (куда вводили номер)
    // const partnerNumberLocal = document.querySelector('.wifi-call-number-input').value;
    // получаем номер того, кому звоним из url
    const urlParams = new URLSearchParams(window.location.search);
    const partnerNumberLocal = urlParams.get('code');
    if (partnerNumberLocal !== '') {
      // установим глобальную переменную parnerNumber (кому звоним)
      partnerNumber = partnerNumberLocal;
      // инициируем звонок
      handleSearchButton(partnerNumberLocal);
    } else {
      console.log("Нет номера");
    }
  }
  if (event.target.matches('.decline-call-button')) { // ожидающий пользователь отклонил вызов
    // отключаем звук
    soundCall.pause();
    soundCall.currentTime = 0;

    // отправим через сервер уведомление инициатору о том, что ожидающий отклонил звонок
    socket.emit('declineWifiCall', {partnerNumber: partnerNumber});
    // console.log(`Отклоняем вызов от ${partnerNumber}`);
    // handleStopSearch();
  }
  if (event.target.matches('.re-wifi-call-button')) { // повторить звонок
    // partnerNumber должен быть установлен после первого вызова
    handleSearchButton(partnerNumber);
  }
  if (event.target.matches('.button_stop-search')) { // отмена поиска / вызова (инициатор отменил вызов)
    // вернём инициатора на главный экран
    handleStartActivity();
    // отправим ожидающему собеседнику уведомление о том, что инициатор отменил звонок
    socket.emit('initiatorDeclineWifiCall', {partnerNumber: partnerNumber});
  }
  if (event.target.matches('.accept-call-button')) { // ожидающий принял вызов
    // отключаем звук
    soundCall.pause();
    soundCall.currentTime = 0;
    // отправляем на сервер сигнал о приёме вызова
    socket.emit('acceptWifiCall', {partnerNumber: partnerNumber});
  }
  if (event.target.matches('#stop-report-button')) {
    handleReportButton(badReportBlackScreen);
  }
  if (event.target.matches('.button_stop-dialog')) {
    handleStopDialog();
  }
  if (event.target.matches('#rating-dislike-button')) {
    handleReportButton(badReportBlackScreen);
  }
  if (event.target.matches('#rating-like-button')) {
    handleReportButton(goodReportBlackScreen);
  }
  if (event.target.matches('.button_start')) {
    handleStartActivity();
  }
  if (event.target.matches('#dialog-microphone-button')) { // клик по кнопке "микрофон"
    if (microphoneEnabled) {
      handleMicrophoneOff(event.target); // выключаем микрофон
    } else {
      handleMicrophoneOn(event.target); // включаем микрофон
    }
  }
  if (event.target.matches('#dialog-sound-button')) { // клик по кнопке "вкл / выкл звук"
    handleToggleSound(event.target);
  }
  if (event.target.matches('#dialog-camera-button')) { // кнопка камеры
    toggleVideo();
  }
});

// функция отключает микрофон
function handleMicrophoneOff(button) {
  button.classList.add('dialog-icons-block__button_microphone-no-active');
  microphoneEnabled = false;
  // Временно отключаем микрофон
  audioTracks.getAudioTracks().forEach(track => track.enabled = false);
  peer.send(JSON.stringify({type: 'partnerMicrophone', partnerMicrophone: false}));
}

// функция включает микрофон
function handleMicrophoneOn(button) {
  button.classList.remove('dialog-icons-block__button_microphone-no-active');
  microphoneEnabled = true;
  // включаем микрофон
  audioTracks.getAudioTracks().forEach(track => track.enabled = true);
  peer.send(JSON.stringify({type: 'partnerMicrophone', partnerMicrophone: true}));
}

// функция включения и отключения звука
function handleToggleSound(button) {
  if(enableSound) { // если звук включён true
    // заглушаем все аудио/видео на странице
    document.querySelectorAll('audio, video').forEach(el => el.muted = true);
    button.classList.add('dialog-icons-block__button_sound-no-active');
    enableSound = false;
  } else {
    // включаем обратно
    document.querySelectorAll('audio, video').forEach(el => el.muted = false);
    button.classList.remove('dialog-icons-block__button_sound-no-active');
    enableSound = true;
  }
}

// Добавьте эту функцию после существующих функций
async function toggleVideo() {
  if (!hasVideoCapability) {
    createAppMessage('Видео недоступно', 'Ваша камера недоступна или заблокирована');
    return;
  }
  
  try {
    if (!isVideoEnabled) {
      // ВКЛЮЧЕНИЕ ВИДЕО
      localStream.getVideoTracks().forEach(track => {
        track.enabled = true;
      });
      
      showLocalVideo(localStream);
      isVideoEnabled = true;
      updateVideoButton(true);
      
      console.log("Видео включено");
      
    } else {
      // ВЫКЛЮЧЕНИЕ ВИДЕО
      localStream.getVideoTracks().forEach(track => {
        track.enabled = false;
      });
      
      hideLocalVideo();
      isVideoEnabled = false;
      updateVideoButton(false);
      
      console.log("Видео выключено");
    }
    
    // Уведомляем партнёра о изменении состояния видео
    if (peer && peer.connected) {
      peer.send(JSON.stringify({
        type: 'videoState',
        videoEnabled: isVideoEnabled
      }));
    }
    
  } catch (error) {
    console.error("Ошибка переключения видео:", error);
    createAppMessage('Ошибка камеры', 'Не удалось переключить видео');
  }
}

// функция показывает локальное видео
function showLocalVideo(stream) {
  let localVideo = document.querySelector('#local-video');
  if (!localVideo) {
    localVideo = document.createElement('video');
    localVideo.id = 'local-video';
    localVideo.muted = true;
    localVideo.autoplay = true;
    localVideo.playsinline = true;
    localVideo.classList.add('local-video');
    
    const activity = document.querySelector('.activity');
    if (activity) {
      activity.appendChild(localVideo);
    }
  }
  localVideo.srcObject = stream;
}

// функция скрывает локальное видео
function hideLocalVideo() {
  const localVideo = document.querySelector('#local-video');
  if (localVideo) {
    localVideo.remove();
  }
}

function updateVideoButton(enabled) {
  const videoButton = document.querySelector('#dialog-camera-button');
  if (!videoButton) return;
  
  if (enabled) {
    videoButton.classList.add('dialog-icons-block__button_camera-active');
    videoButton.classList.remove('dialog-icons-block__button_camera-no-active');
  } else {
    videoButton.classList.remove('dialog-icons-block__button_camera-active');
    videoButton.classList.add('dialog-icons-block__button_camera-no-active');
  }
}


// функция добавляет и убирает видео, если собеседник включил и отключил видео
function updatePartnerVideoState(videoEnabled) {
  const partnerVideo = document.querySelector('#partner-video');
  if (partnerVideo) {
    if (videoEnabled) {
      partnerVideo.style.display = 'block';
      dialogPeerStatus('Собеседник включил видео');
      setTimeout(() => dialogPeerStatus(''), 3000);

      const videoBox = document.querySelector('#partner-video-block');
      videoBox.classList.add('video-box_active');
    } else {
      partnerVideo.style.display = 'none';
      dialogPeerStatus('Собеседник выключил видео');
      setTimeout(() => dialogPeerStatus(''), 3000);

      const videoBox = document.querySelector('#partner-video-block');
      videoBox.classList.add('video-box');
      videoBox.classList.remove('video-box_active');
      videoBox.classList.remove('video-box_full-screen');

      const dialogButtonBox = document.querySelector('.dialog-button-box');
      dialogButtonBox.classList.remove('dialog-button-box_full-screen');
    }
  }
}

// функция корректно устанавливает имя пользователя
function handleInputUsername(event) {
  const inputNickname = event.target;
  nickname = inputNickname.value.replace(/[^a-zA-Zа-яА-Я]/g, '');
  inputNickname.value = nickname;
}

// test ------------------------------------------------------------------------------------------------------
// Проверка разрешения к микрофону
async function checkMicrophonePermission() {
  try {
    // Запрашиваем доступ к микрофону
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Если поток получен, останавливаем его, так как он нужен только для проверки
    stream.getTracks().forEach(track => track.stop());
    return true; // Разрешение предоставлено
  } catch (err) {
    console.error("Доступ к микрофону не предоставлен:", err);
    return false; // Разрешение отклонено
  }
}

function startSearch(partnerNumber) {
  // Проверяем доступ к микрофону
  checkMicrophonePermission().then(hasPermission => {
    if (hasPermission) { // есть доступ к микрофону
      // console.log("Доступ к микрофону предоставлен. Начинаем поиск собеседника...");
        
      socket.emit('search', {type: 'wifiCall', partnerNumber: partnerNumber, nickname: nickname});
      searchActivity();
    } else {
      microphoneActivity();
      // console.log("Доступ к микрофону не предоставлен.");
    }
  }).catch(error => {
    console.error("Ошибка проверки доступа к микрофону:", error);
  });
}

// функция поиска нового диалога
function handleSearchButton(partnerNumber) {
  // partnerId = ''; // очищаем переменную
  startSearch(partnerNumber);
  /* socket.emit('search', {nickname});
  searchActivity(); */
}

// функция остановит поиск в searchActivity
function handleStopSearch() {
  // очистка peer, старый peer должен уничтожаться
  if (peer) {
    peer.destroy();
    peer = null;
  }

  socket.emit('handleStopSearch', {type: 'voiceRoulette', message: 'handleStopSearch'});
  startActivity();
}

// функция откроет чёрный экран с жалобой
function handleReportButton(blackScreen) {
  openBlackScreen(blackScreen);
}

// функция завершит диалог
function handleStopDialog() {
  peer.destroy(); // разрываем webrtc-соединение
  peer = null;
  // сообщить через сервер о завершении диалога другому собеседнику
  socket.emit('stopDialog', {type: 'voiceRoulette', partnerId: partnerId});
  stopDialogActivity();
}

function handleStartActivity() {
  startActivity();
}

// функция установит нужное activity
function setActivity(activity) {
  const allActivities = document.querySelectorAll('.activity');
     
  // удаляем все activity
  allActivities.forEach((item) => {
    item.remove();
  });

  // устанавливаем нужную activity
  app.appendChild(activity);
}

function startActivity(canWifiCall=true) {
  // получаем из ссылки get параметр 'code'
  const urlParams = new URLSearchParams(window.location.search);
  const sessionCode = urlParams.get('code');

  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');

  // общий текст startActivity
  let innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">Анонимные звонки.pro</h1>
      <h2 class="activity__title_description">🎙️ Анонимные WiFi голосовые звонки</h2>
      <p class="text-box__p text-box__p_center text-color_red text_uppercase text_mini">
        Заблокированы голосовые звонки? Звони тут!
      </p>
    </div>
  `;

  if (!sessionCode) { // в ссылке нет кода для звонка, вы инициатор звонка (1-й собеседник)
    innerHTML += `
      <div class="your-number-block">
        <p class="your-number-block__title">Ваша одноразовая ссылка с номером:</p>
        <p class="your-number-block__number" id="your-number"></p>
        <span class="your-number-block__description">
          создаём временный номер
        </span>
      </div>

      <ul class="wifi-call-instruction">
        <li>1. Кликните по блоку с номером (ссылка)</li>
        <li>2. Отправьте её собеседнику любым способом</li>
        <li>3. После перехода по ссылке он сможет позвонить</li>
      </ul>
    `;
  } else { // если в ссылке есть код для звонка (2-й собеседник)
    if (canWifiCall) { // если есть возможность позвонить (session.id собеседника актуальная)
      innerHTML += `
        <div class="vertical-box">
          <p class="text-box__p text-box__p_center text_mini text_uppercase">Ваш собеседник ждёт звонок</p>
          <button class="activity__button button button_search wifi-call-button">Позвонить</button>
        </div>
        <div class="vertical-box">
          <p class="text-box__p text-box__p_center text_mini text_uppercase">
            Создать ссылку и стать инициатором
          </p>
          <button class="activity__button button button_get-initiator">Стать  инициатором</button>
        </div>
      `;
    } else {
      innerHTML += `
        <div class="vertical-box">
          <h2 class="activity__title_description text-color_red">⚠️ У собеседника сменился номер</h2>
          <p class="text-box__p text-box__p_center">
            Попросите собеседника отправить новую ссылку или станьте инициатором звонка и пришлите ему свою
          </p>
        </div>
        <div class="vertical-box">
          <p class="text-box__p text-box__p_center">
            Создать свою ссылку и стать инициатором
          </p>
          <button class="activity__button button button_get-initiator">Стать  инициатором</button>
        </div>
      `;
    }
  }

  innerHTML += `<p class="text-color_red text_uppercase text_mini">Работает только по WiFi</p>`;
  activity.innerHTML = innerHTML;
  setActivity(activity);

  if (!sessionCode) { // если пользователь создаёт звонок
    // код-ссылка вставляется при первом / новом подключении выше, когда присваивается clientId

    // копируем номер и ссылку по клику
    const yourNumberBlock = activity.querySelector('.your-number-block');
    yourNumberBlock.addEventListener('click', () => {
      const yourNumber = yourNumberBlock.querySelector('#your-number').textContent;
      const baseLink = `${window.location.origin}${window.location.pathname}`;
      const fullLink = `${baseLink}?code=${yourNumber}`;
      navigator.clipboard.writeText(fullLink)
        .then(() => {
          const desc = activity.querySelector('.your-number-block__description');
          desc.textContent = '(ссылка скопирована - передайте её собеседнику)';
        })
        .catch(err => console.error('Ошибка копирования номера: ', err));
    });
  } else { // если пользователь принимает приглашение к звонку
    const buttonGetInitiator = activity.querySelector('.button_get-initiator');
    // клик по кнопе "стать инициатором"
    buttonGetInitiator.addEventListener('click', () => {
      const clearLink = `${window.location.origin}${window.location.pathname}`; // ссылка без get-параметров
      // поменяем url на чистый без параметров
      window.location.href = clearLink;
    });
    console.log(`Пользователь вошёл по коду: ${sessionCode}`);
  }
}

// функция создаёт searchActivity (ожидание ответа при звонке)
function searchActivity() {
  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');
  activity.innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">Идёт вызов</h1>
    </div>
    <div class="activity__search-animation search-animation-block">
      <p class="text-box__p text-box__p_center text_uppercase text_mini">Ожидаем ответ второго собеседника</p>
      <div class="loader"></div>
    </div>
    <button class="activity__button button button_stop-search">Остановить</button>
  `;

  setActivity(activity);
}

// функция создаёт sendCallActivity (входящий вызов)
function sendCallActivity() {
  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');
  activity.innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">Входящий вызов</h1>
    </div>
    <div class="activity__search-animation search-animation-block">
      <p class="text-box__p text-box__p_center text_uppercase text_mini">Собеседник ожидает ваш ответ</p>
      <div class="loader"></div>
    </div>
    <div class="wifi-call-send-button-block">
      <button class="activity__button button button_stop-search decline-call-button">Отклонить</button>
      <button class="activity__button button button_search accept-call-button">Ответить</button>
    </div>
  `;

  setActivity(activity);
}

// функция создаст activityDialog
// функция создаст activityDialog
function dialogActivity() {
  microphoneEnabled = true;
  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');
  activity.innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">Активный звонок</h1>
      <p class="text-box__p text-box__p_center text-color_grey text_uppercase text_mini text-width_80">
        Не допускайте блокировку экрана и не сворачивайте эту вкладку
      </p>
    </div>
    <div class="activity__block dialog-data">
      <h2 class="dialog-data__logo">🎙️</h2>
      <div class="dialog-data__detail">
        <p class="dialog-data__timer">00:00:00</p>
      </div>
      <p class="dialog-data__connect-info"></p>
    </div>
    <div class="dialog-button-box">
      <button class="activity__button button button_stop-dialog button_stop-dialog_100" id="stop-dialog-button">Завершить</button>
      <div class="dialog-icons-block">
      <button class="dialog-icons-block__button dialog-icons-block__button_sound-active" id="dialog-sound-button"></button>
        <button class="dialog-icons-block__button dialog-icons-block__button_microphone-active" id="dialog-microphone-button"></button>
        <button class="dialog-icons-block__button dialog-icons-block__button_camera-active dialog-icons-block__button_camera-no-active" id="dialog-camera-button"></button>
      </div>
    </div>
    <div class="dialog-video-box video-box" id="partner-video-block">
      <button class="video-box__button-full-screen"></button>
    </div>
  `;

  let buttonFullScreen = false;
  const dialogButtonBox = activity.querySelector('.dialog-button-box');
  const videoBoxFullScreenButton = activity.querySelector('.video-box__button-full-screen');
  videoBoxFullScreenButton.addEventListener('click', () => {
    console.log(buttonFullScreen);
    const partnerVideoBlock = activity.querySelector('#partner-video-block');
    if (!buttonFullScreen) { // не полный экран
      buttonFullScreen = true;
      partnerVideoBlock.classList.remove('video-box');
      partnerVideoBlock.classList.add('video-box_full-screen');
      dialogButtonBox.classList.add('dialog-button-box_full-screen');
    } else {
      buttonFullScreen = false;
      partnerVideoBlock.classList.add('video-box');
      partnerVideoBlock.classList.remove('video-box_full-screen');
      dialogButtonBox.classList.remove('dialog-button-box_full-screen');
    }
  });

  isReportCurrentDialog = false;
  isWiFiCallBusy = true;
  setActivity(activity);
}

// функция создаёт activity stopDialog
function stopDialogActivity() {
  // Останавливаем видео если было включено
  if (localStream && isVideoEnabled) {
    localStream.getVideoTracks().forEach(track => track.stop());
  }

  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');
  activity.innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">Диалог завершён</h1>
    </div>
    <p class="text-box__p text-box__p_center text_uppercase text_mini">Один из собеседников завершил диалог</p>
    <div class="activity__vertical-box vertical-box stop-dialog-button-box">
      <button class="activity__button button button_start button-start_width">Вернуться в начало</button>
      <button class="activity__button button button_search re-wifi-call-button">Перезвонить</button>
    </div>
  `;

  stopTimer();
  isWiFiCallBusy = false; // клиент больше не занят разговором
  enableSound = true; // включаем все звуки
  setActivity(activity);
}

// функция создаёт banActivity (бан)
function banActivity(code, banDate) {
  const reportText = codeReportList[code].text;
  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');
  activity.innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">😵 Бан!</h1>
      <p class="text-box__p text-box__p_center">По причине: <span class="text-color_red">${reportText}</span></p>
    </div>
    <div class="vertical-box">
      <p class="text-box__p text-box__p_center">А мы предупреждали, что не нужно баловаться 😉</p>
      <p class="text-box__p text-box__p_center">Разблокировка снимется: 
        <span class="text-color_red">${banDate}</span>
      </p>
    </div>
    <p class="text-box__p text-box__p_center">Пожалуйста, не нарушайте правила сообщества, которые можно 
      прочитать в <span class="text-color_red">Mеню -> Правила</span>
    </p>
  `;

  setActivity(activity);
}

// функция создаёт activity с оповещением о необходимости включить микрофон
function microphoneActivity() {
  const activity = document.createElement('div');
  activity.classList.add('app__activity', 'activity');
  activity.innerHTML = `
    <div class="vertical-box">
      <h1 class="activity__title">🎙️ включите микрофон</h1>
    </div>
    <p class="text-box__p text-box__p_center">Чтобы общаться и искать новых друзей нужно дать разрешение на использование микрофона</p>
    <div class="microphone-instruction-box">
      <span>🔒</span>
      <span>https://website.com</span>
      <span></span>
    </div>
    <p class="text-box__p text-box__p_center">
      В адресной строке браузера <span class="text-color_red">нажмите на значок замка</span> в самом начале или 
      на значок камеры или микрофона в самом конце. В появившемся окне 
      <span class="text-color_red">разрешите доступ к микрофону</span>
    </p>
    <button class="activity__button button button_start">Вернуться в начало</button>
  `;

  setActivity(activity);
}

// начальная activity
startActivity();
// dialogActivity();
// sendCallActivity();
// banActivity(2);
// microphoneActivity();

// устанавливаем значения localStarage, если их не было
initializeLocalStorage({lastActive: getDateNow(), isBan: false, banCode: null, banDate: null, reportCount: null});

// обнуляем каждый новый день счётчик репортов
if(new Date(getDateNow()).getTime() !== new Date(JSON.parse(localStorage.getItem('lastActive'))).getTime()) {
  // console.log('даты ... разные');
  updateLocalStorage('lastActive', getDateNow());
  localStorage.removeItem('reports'); // обнулим счётчик жалоб
}
