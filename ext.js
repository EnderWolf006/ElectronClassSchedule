let store = void 0;
let timer = exports.timer = require("./ext/timer")
let notice = exports.notice = require("./ext/notice")

exports.pass = function(data) {
    store = data.store
    timer.pass(data)
    notice.pass(data)
}

exports.load = function() {
    timer.load()
    notice.load()
}
