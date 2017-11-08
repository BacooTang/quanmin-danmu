const ws = require('ws')
const fs = require('fs')
const crc32 = require('./crc32')
const events = require('events')
const gateway = require('./gateway')
const protobuf = require("protobufjs")
const request = require('request-promise')
const to_arraybuffer = require('to-arraybuffer')
const REQUEST_TIMEOUT = 10000
const HEART_BEAT_INTERVAL = 15000
const FRESH_GIFT_INFO_INTERVAL = 30 * 60 * 1000

class quanmin_danmu extends events {
    constructor(roomid) {
        super()
        this._roomid = roomid
    }

    async _get_uid() {
        let opt = {
            url: `http://m.quanmin.tv/${this._roomid}`,
            timeout: REQUEST_TIMEOUT,
            gzip: true,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/61.0.3163.100 Mobile Safari/537.36'
            }
        }
        try {
            let body = await request(opt)
            let uid_array = body.match(/"no":\d+,"uid":(\d+)/)
            if (!uid_array || !uid_array[1]) {
                return null
            }
            return parseInt(uid_array[1])
        } catch (e) {
            return null
        }
    }

    async _get_gift_info() {
        let gift_info = {}
        let opt = {
            url: `https://www.quanmin.tv/shouyin_api/public/config/gift/pc?debug&platform=1`,
            timeout: REQUEST_TIMEOUT,
            json: true,
            gzip: true
        }
        try {
            let body = await request(opt)
            if (!body) {
                return null
            }
            body.data.lists.forEach(item => {
                gift_info[item.attrId] = {
                    name: item.name,
                    price: item.diamond
                }
            })
            opt.url = `https://www.quanmin.tv/shouyin_api/public/config/gift/pc?debug&platform=2`
            body = await request(opt)
            if (!body) {
                return null
            }
            body.data.lists.forEach(item => {
                gift_info[item.attrId] = {
                    name: item.name,
                    price: item.diamond
                }
            })
            return gift_info
        } catch (e) {
            return null
        }
    }

    async _get_auth_data() {
        let opt = {
            url: 'http://m.quanmin.tv/shouyin_api/auth/get/authData?debug',
            timeout: REQUEST_TIMEOUT,
            json: true,
            gzip: true
        }
        try {
            let body = await request(opt)
            let data = body.data
            data.devid = ''
            data.app = 'webapp'
            data.ver = '20170713.01'
            data.channel = 'quanmin-H5'
            return data
        } catch (e) {
            return null
        }
    }

    async _load_proto_file() {
        let opt = {
            url: 'http://m.quanmin.tv/static/v2/m/lib/pb-socket/msg.proto',
            timeout: REQUEST_TIMEOUT,
            json: true,
            gzip: true
        }
        try {
            let body = await request(opt)
            fs.writeFileSync('./msg.proto', body)
            return await protobuf.load("./msg.proto")
        } catch (e) {
            return null
        }
    }

    _init_crc_obj() {
        this._receive_crc_obj = {}
        for (var name in gateway) {
            this._receive_crc_obj[crc32(name)] = name
        }
    }

    async start() {
        if (this._starting) {
            return
        }
        this._starting = true
        this._init_crc_obj()
        this._uid = await this._get_uid()
        if (!this._uid || !this._starting) {
            this.emit('error', new Error('Fail to get uid'))
            return this.emit('close')
        }
        this._gift_info = await this._get_gift_info()
        if (!this._gift_info || !this._starting) {
            this.emit('error', new Error('Fail to get gift info'))
            return this.emit('close')
        }
        this._fresh_gift_info_timer = setInterval(this._fresh_gift_info.bind(this), FRESH_GIFT_INFO_INTERVAL)
        this.pb = await this._load_proto_file()
        if (!this.pb || !this._starting) {
            this.emit('error', new Error('Fail to load proto file'))
            return this.emit('close')
        }
        this._auth_data = await this._get_auth_data()
        if (!this._auth_data || !this._starting) {
            this.emit('error', new Error('Fail to get auth data'))
            return this.emit('close')
        }
        this._start_ws()
    }

    _start_ws() {
        this._client = new ws("ws://h5_ws.quanmin.tv:8890/ws")
        this._client.on('open', () => {
            this.emit('connect')
            this._login_req()
            this._heartbeat_timer = setInterval(this._heartbeat.bind(this), HEART_BEAT_INTERVAL)
        })
        this._client.on('error', err => {
            this.emit('error', err)
        })
        this._client.on('close', () => {
            this._stop()
            this.emit('close')
        })
        this._client.on('message', this._on_msg.bind(this))
    }

    _login_req() {
        this._send(this._auth_data, "Gateway.Login.Req")
    }


    async _fresh_gift_info() {
        let gift_info = await this._get_gift_info()
        if (!gift_info) {
            return this.emit('error', new Error('Fail to get gift info'))
        }
        this._gift_info = gift_info
        console.log(this._gift_info);
    }

    _heartbeat() {
        this._send("keep alive", 0)
    }

    _on_msg(e) {
        e = to_arraybuffer(e)
        for (var n = new ArrayBuffer(16), r = new DataView(n), i = new Int32Array(e.slice(0, 16)), o = 0, s = i.length; s > o; o++)
            r.setInt32(4 * o, i[o], !1);
        var a = (r.getInt32(4, 8, !1), this._receive_crc_obj[r.getInt32(8, 12, !1)])
        var l = new Uint8Array(e.slice(16));
        if (a) {
            var u = this._decode(l, a);
            this._format_msg(u, a)
        }
    }

    _format_msg(msg, type) {
        let msg_obj
        switch (type) {
            case 'Gateway.Login.Resp':
                this._send({ owid: this._uid }, "Gateway.RoomJoin.Req")
                break;
            case 'Gateway.Chat.Notify':
                let plat = 'pc_web'
                if (msg.platForm === 'iOS') {
                    plat = 'ios'
                } else if (msg.platForm === 'android') {
                    plat = 'android'
                }
                msg_obj = {
                    type: 'chat',
                    time: new Date().getTime(),
                    from: {
                        name: msg.user.nickname,
                        rid: msg.user.uid + '',
                        level: msg.user.level,
                        plat: plat
                    },
                    content: msg.txt,
                    raw: msg
                }
                this.emit('message', msg_obj)
                break;
            case 'Gateway.Gift.Notify':
                if (msg.owid != this._uid) {
                    return
                }
                let gift = this._gift_info[msg.attrId + ''] || { name: '未知礼物', price: 0 }
                msg_obj = {
                    type: 'gift',
                    time: msg.retetionAttr.nowTime,
                    name: gift.name,
                    from: {
                        name: msg.user.nickname,
                        rid: msg.user.uid + '',
                        level: msg.user.level
                    },
                    count: msg.count,
                    price: msg.count * gift.price,
                    raw: msg
                }
                this.emit('message', msg_obj)
                break;
            case 'Gateway.RoomUpdate.Notify':
                msg_obj = {
                    type: 'online',
                    time: new Date().getTime(),
                    count: msg.liveData.online,
                    raw: msg
                }
                this.emit('message', msg_obj)
                msg_obj = {
                    type: 'fight',
                    time: new Date().getTime(),
                    count: msg.liveData.fight,
                    raw: msg
                }
                this.emit('message', msg_obj)
                break;
            default:
                msg_obj = {
                    type: 'other',
                    time: new Date().getTime(),
                    raw: msg
                }
                this.emit('message', msg_obj)
                break;
        }
    }

    _encode(e, t) {
        let n = this.pb.lookup(gateway[t])
        let r = n.create(e)
        let err = n.verify(r)
        if (err) {
            return this.emit('error', err)
        }
        let o = n.encode(r).finish()
        return o
    }

    _decode(e, t) {
        let n = this.pb.lookup(gateway[t])
        let r = n.decode(e, e.byteLength)
        let err = n.verify(r);
        if (err) {
            return this.emit('error', err)
        }
        return r
    }

    _send(e, t) {
        var n;
        n = 0 === t ? [] : this._encode(e, t);
        var r = new ArrayBuffer(n.length + 16)
            , i = new DataView(r);
        0 !== t && (t = crc32(t)),
            i.setInt32(0, 0, !1),
            i.setInt32(4, n.length, !1),
            i.setInt32(8, t, !1),
            i.setInt32(12, crc32(n), !1);
        for (var o = 0, s = n.length; s > o; o++)
            i.setUint8(o + 16, n[o]);
        if (this._client) {
            try {
                this._client.send(r)
            } catch (err) {
                return this.emit('error', err)
            }
        }
    }

    _stop() {
        this._starting = false
        clearInterval(this._heartbeat_timer)
        clearInterval(this._fresh_gift_info_timer)
        this._client && this._client.terminate()
    }

    stop() {
        this.removeAllListeners()
        this._stop()
    }
}

module.exports = quanmin_danmu