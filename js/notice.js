const statuses = {
  'doing':    ['进行中', 'statusDoing',    '${timer}'],
  'pinned':   ['已固定', 'statusPinned',   '${timer}'],
  'updated':  ['已更新', 'statusUpdated',  '已更新为${updated}'],
  'finished': ['已结束', 'statusFinished', '已结束']
}

let noticeContainer = document.getElementById('noticeContainer')
let summary = document.getElementById('summary')

let displayed = []
/*
  index: string
  updated: number
  status: string
  updatedTarget: string
  createTime: number
  finishTime: number
  content: string

  height: number
  processedLines: string[]
  pinned: boolean
  
  container: dom node
  timer: dom node
*/
let notices = {}
let summaryData = {latestIndex: 0}

let fontSize, containerWidth
let maxHeight = 0;
let heightPerCol = 0;
let usedHeight = 0;

let updateTimer = Date.now();
let duration;
let forEachIndex = 0;
let forEachIndexMax;

handleConfigs(({ ext: { notice: { css, duration: d, maxIndex } } }) => { 
  fontSize = +css['--font-size'].replace('px', '')
  containerWidth = +css['--container-width'].replace('px', '')
  duration = d
  forEachIndexMax = maxIndex

  let width = noticeContainer.clientWidth
  let height = noticeContainer.clientHeight
  heightPerCol = Math.floor(height / fontSize)
  let cols = Math.floor(width / containerWidth)
  maxHeight = cols * heightPerCol
});

function calculateHeight(){
  let height = 0
  for (let key of displayed) {
    let notice = notices[key]
    height += notice.height
  }
  usedHeight = height
  return height
}

ipcRenderer.on("notice.data", (event, data, summary) => {
  let updated = false
  for (let key in data) {
    if (notices[key] && notices[key].updated == data[key].updated) continue
    notices[key] = Object.assign(notices[key] || {}, data[key])
    process(notices[key])
    updated = true
  }
  for (let key in notices) {
    if (data[key]) continue
    removeNotice(notices[key])
    delete notices[key]
    updated = true
  }
  summaryData = summary
  if (updated) {
    updateTimer = 0
  }
  updateSummary()
})

function process(notice){
  let chars = Math.floor(containerWidth / fontSize)
  let height = 1;
  let lines = notice.content.split('\n')
  let processedLines = []
  while (lines.length > 0) {
    let line = lines.shift()
    processedLines.push(line.substring(0, chars))
    line = line.substring(chars)
    if (line.length != 0) lines.unshift(line)
    height += 1
  }
  notice.nindex = notice.index
  notice.index = indexToString(notice.index)
  notice.updatedTarget = indexToString(notice.updatedTarget || 0)
  notice.processedLines = processedLines
  notice.height = height
  if (notice.pinned) notice.status = 'pinned'
}

function removeDisplayed(){
  for (let key of displayed) {
    if (notices[key].pinned) continue;
    removeNotice(notices[key])
    if (notices[key].finishTime + noticeConfig.finishedDuration < Date.now())
      ipcRenderer.send('notice.removeFinished', key)
  }
  calculateHeight()
}

function indexToString(index){
  return '#' + index.toString().padStart(Math.log10(forEachIndexMax), '0')
}

function addNotice(notice){
  if (notice.elements) removeNotice(notice)
  let container = document.createElement('div')
  container.classList.add('itemContainer')
  let index = document.createElement('div')
  index.classList.add('statusLineIndex')
  if (notice.createTime >= Date.now() - noticeConfig.latestDuration)
      index.classList.add('statusLatest')
  index.innerText = notice.index
  let status = document.createElement('div')
  status.classList.add('statusLineText')
  status.classList.add(statuses[notice.status][1])
  status.innerText = ` [${statuses[notice.status][0]}] `
  let timer = document.createElement('div')
  timer.classList.add('statusLineCountdown')
  timer.innerText = getTimerText(notice)
  container.appendChild(index)
  container.appendChild(status)
  container.appendChild(timer)
  noticeContainer.appendChild(container)
  notice.elements = [container]
  notice.timer = timer
  notice.processedLines.forEach(line => {
    let element = document.createElement('div')
    element.classList.add('itemLine')
    element.innerText = line
    noticeContainer.appendChild(element)
    notice.elements.push(element)
  })
  displayed.push(notice.nindex)
}

function removeNotice(notice){
  if (!notice.elements) return
  notice.elements.forEach(e => e.remove())
  displayed.splice(displayed.indexOf(notice.nindex), 1)
  notice.elements = null
  notice.timer = null
}

function getCountdownText(targetTime){
  if (targetTime < Date.now()) return '已结束'
  let days = Math.floor((targetTime - Date.now()) / 1000 / 60 / 60 / 24)
  let hours = Math.floor(((targetTime - Date.now()) / 1000 / 60 / 60) % 24).toString().padStart(2, '0')
  let minutes = Math.floor(((targetTime - Date.now()) / 1000 / 60) % 60).toString().padStart(2, '0')
  let seconds = Math.floor(((targetTime - Date.now()) / 1000) % 60).toString().padStart(2, '0')
  if (days != 0) days = `${days}天 `;
  else days = ''
  return `${days}${hours}:${minutes}:${seconds}`
}

function getTimerText(notice){
  return statuses[notice.status][2]
    .replace('${timer}', () => getCountdownText(notice.finishTime))
    .replace('${updated}', () => notice.updatedTarget)
}

function addNew(){
  let height = usedHeight
  let i = forEachIndex
  do{
    let notice = notices[i]
    i = (i + 1) % forEachIndexMax
    if (!notice) continue
    usedHeight = height
    height += notice.height
    if (height > maxHeight){
      i = (i + forEachIndexMax - 1) % forEachIndexMax
      break
    }
    addNotice(notice)
  }while(i != forEachIndex)
  forEachIndex = i
}

function checkUpdateNotices(){
  if (updateTimer > Date.now()) return
  updateTimer = Date.now() + duration;
  removeDisplayed()
  addNew()
}

function update(){
  checkUpdateNotices()
  for (let key of displayed) {
    notices[key].timer.innerText = getTimerText(notices[key])
  }
}

setInterval(update, 1000)

function updateSummary(){
  summaryData.doingCount = 0
  summaryData.finishedCount = 0
  summaryData.updatedCount = 0

  for (let key in notices) {
    let notice = notices[key]
    if (notice.status == 'doing' || notice.status == 'pinned') summaryData.doingCount += 1
    if (notice.status == 'finished') summaryData.finishedCount += 1
    if (notice.status == 'updated') summaryData.updatedCount += 1
  }

  summary.innerText = `最新: ${indexToString(summaryData.latestIndex)} `
    + `进行中: ${summaryData.doingCount} 已更新: ${summaryData.updatedCount} `
    + `已结束: ${summaryData.finishedCount}`
}

ipcRenderer.send('notice.getData')
