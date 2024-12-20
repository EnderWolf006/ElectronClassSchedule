const _scheduleConfig = {
    // 通知表样式: 配置通知表样式CSS变量, 包括字体大小，透明度等属性
    // 请不要更改冒号前半部分文字, 请更改冒号后单引号中的数字(切勿删除引号与数字后的单位), 如果你对CSS有所了解你也可以尝试更改CSS单位
    css_style: {
        '--font-size': '28px', // 字体大小
        '--global-border-radius': '16px', // 所有背景框的圆角大小
        '--global-bg-opacity': '0.5', // 所有背景框的不透明度, 范围: [0, 1]
        '--container-bg-padding': '8px 14px', // 上面三个框各自的背景内边距, 前面的数字表示纵向边距，后面的数字表示横向边距
        '--notice-top-space': '20%', // 通知表主体最顶端与电脑屏幕上边框的间隔长度
        '--notice-left-space': '55%', // 通知表主体最顶端与电脑屏幕左边框的间隔长度
        '--notice-width': '80%', // 通知表主体宽度
        '--notice-height': '66%', // 通知表主体高度
        '--container-width': '500px', // 通知的宽度
    },
    duration: 30*1000, // 通知持续时间
    maxIndex: 100, // 通知最大索引
    latestDuration: 1*60*60*1000, // 最新通知持续时间
    finishedDuration: 30*60*1000, // 已结束通知持续时间
}

var noticeConfig = JSON.parse(JSON.stringify(_scheduleConfig))
