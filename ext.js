let store = void 0;
let config = exports.config = require("./ext/config")
let timer = exports.timer = require("./ext/timer")
let notice = exports.notice = require("./ext/notice")

exports.pass = function(data) {
    store = data.store
    config.pass(data)
    timer.pass(data)
    notice.pass(data)
}

exports.load = function() {
    config.load()
    timer.load()
    notice.load()
}
