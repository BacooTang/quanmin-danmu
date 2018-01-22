const ws = require('ws')
const fs = require('fs')
const md5 = require('md5')
const crc32 = require('./crc32')
const events = require('events')
const gateway = require('./gateway')
const protobuf = require("protobufjs")
const request = require('request-promise')
const socks_agent = require('socks-proxy-agent')
const to_arraybuffer = require('to-arraybuffer')

const timeout = 30000
const heartbeat_interval = 15000
const fresh_gift_interval = 60 * 60 * 1000
const free_gift = { name: '未知礼物', price: 0 }
const r = request.defaults({ json: true, gzip: true, timeout: timeout })

class quanmin_danmu extends events {
    constructor(opt) {
        super()
        if (typeof opt === 'string')
            this._roomid = opt
        else if (typeof opt === 'object') {
            this._roomid = opt.roomid
            this.set_proxy(opt.proxy)
        }
    }

    set_proxy(proxy) {
        this._agent = new socks_agent(proxy)
    }

    async _get_room_info() {
        try {
            let body = await r({
                url: `https://www.quanmin.tv/${this._roomid}`,
                agent: this._agent
            })
            let info_array = body.match(/({"uid":.+"ignore_ad":true})/)
            let info = JSON.parse(info_array[1])
            this._uid = parseInt(info.uid)
            let category_id_array = body.match(/"roomCategoryID":"(\d+)"/)
            this._category_id = category_id_array[1]
        } catch (e) {
            this.emit('error', new Error('Fail to get uid'))
        }
    }

    async _get_gift_info() {
        let gift_info = {}
        for (let i = 1; i <= 2; i++) {
            try {
                let body = await r({
                    url: `https://www.quanmin.tv/shouyin_api/public/config/gift/pc?debug&categoryId=${this._category_id}&platform=${i}`,
                    agent: this._agent
                })
                body.data.lists.forEach(item => {
                    gift_info[item.attrId] = {
                        name: item.name,
                        price: item.diamond
                    }
                })
            } catch (e) { return }
        }
        return gift_info
    }

    async _get_auth_data() {
        try {
            let body = await r({
                url: 'http://m.quanmin.tv/shouyin_api/auth/get/authData?debug',
                agent: this._agent
            })
            let data = body.data
            data.devid = ''
            data.app = 'webapp'
            data.ver = '20170713.01'
            data.channel = 'quanmin-H5'
            return data
        } catch (e) {
            this.emit('error', new Error('Fail to get auth data'))
        }
    }

    async _load_proto_file() {
        try {
            return await protobuf.load(__dirname + '/msg.proto')
        } catch (e) {
            this.emit('error', new Error('Fail to load proto file'))
        }
    }

    _init_crc_obj() {
        this._receive_crc_obj = {}
        for (var name in gateway) {
            this._receive_crc_obj[crc32(name)] = name
        }
    }

    async _fresh_gift_info() {
        let gift_info = await this._get_gift_info()
        if (!gift_info)
            return this.emit('error', new Error('Fail to get gift info'))
        this._gift_info = gift_info
    }

    async start() {
        if (this._starting) return
        this._starting = true

        await this._get_room_info()
        if (!this._uid) return this.emit('close')

        this.pb = this.pb || await this._load_proto_file()
        if (!this.pb) return this.emit('close')

        this._auth_data = await this._get_auth_data()
        if (!this._auth_data) return this.emit('close')

        await this._fresh_gift_info()
        if (!this._gift_info) return this.emit('close')

        this._init_crc_obj()
        this._fresh_gift_info_timer = setInterval(this._fresh_gift_info.bind(this), fresh_gift_interval)

        this._start_ws()
    }

    _start_ws() {
        this._client = new ws("ws://h5_ws.quanmin.tv:8890/ws", {
            perMessageDeflate: false,
            agent: this._agent
        })
        this._client.on('open', () => {
            this._login_req()
            this._heartbeat_timer = setInterval(this._heartbeat.bind(this), heartbeat_interval)
            this.emit('connect')
        })
        this._client.on('error', err => {
            this.emit('error', err)
        })
        this._client.on('close', async () => {
            this._stop()
            this.emit('close')
        })
        this._client.on('message', this._on_msg.bind(this))
    }

    _login_req() {
        this._send(this._auth_data, "Gateway.Login.Req")
    }

    _heartbeat() {
        this._send("keep alive", 0)
    }

    _on_msg(e) {
        try {
            e = to_arraybuffer(e)
            for (var n = new ArrayBuffer(16), r = new DataView(n), i = new Int32Array(e.slice(0, 16)), o = 0, s = i.length; s > o; o++)
                r.setInt32(4 * o, i[o], !1);
            var a = (r.getInt32(4, 8, !1), this._receive_crc_obj[r.getInt32(8, 12, !1)])
            var l = new Uint8Array(e.slice(16));
            if (a) {
                var u = this._decode(l, a);
                this._format_msg(u, a)
            }
        } catch (e) {
            this.emit('error', e)
        }
    }

    _build_chat(msg) {
        let plat = 'pc_web'
        if (msg.platForm === 'iOS') {
            plat = 'ios'
        } else if (msg.platForm === 'android') {
            plat = 'android'
        }
        return {
            type: 'chat',
            time: new Date().getTime(),
            from: {
                name: msg.user.nickname,
                rid: msg.user.uid + '',
                level: msg.user.level,
                plat: plat
            },
            id: md5(JSON.stringify(msg)),
            content: msg.txt
        }
    }

    _build_gift(msg) {
        let gift = this._gift_info[msg.attrId + ''] || free_gift
        let msg_obj = {
            type: 'gift',
            time: msg.retetionAttr.nowTime,
            name: gift.name,
            from: {
                name: msg.user.nickname,
                rid: msg.user.uid + '',
                level: msg.user.level
            },
            id: md5(JSON.stringify(msg)),
            count: msg.count,
            price: msg.count * gift.price,
            earn: msg.count * gift.price * 0.1,
        }
        if (gift.name.indexOf('种子') > -1) {
            msg_obj.type = 'zhongzi'
            delete msg_obj.price
            delete msg_obj.earn
        }
        return msg_obj
    }

    _emit_room_update(msg) {
        const now = new Date().getTime()
        let msg_obj = {
            type: 'online',
            time: now,
            count: msg.liveData.online
        }
        this.emit('message', msg_obj)
        msg_obj = {
            type: 'fight',
            time: now,
            count: msg.liveData.fight
        }
        this.emit('message', msg_obj)
        msg_obj = {
            type: 'room',
            time: now,
            online: msg.liveData.online,
            fight: msg.liveData.fight
        }
        this.emit('message', msg_obj)
    }

    _format_msg(msg, type) {
        let msg_obj
        switch (type) {
            case 'Gateway.Login.Resp':
                this._send({ owid: this._uid }, "Gateway.RoomJoin.Req")
                break;
            case 'Gateway.Chat.Notify':
                if (msg.owid != this._uid) return
                msg_obj = this._build_chat(msg)
                this.emit('message', msg_obj)
                break;
            case 'Gateway.Gift.Notify':
                if (msg.owid != this._uid) return
                msg_obj = this._build_gift(msg)
                this.emit('message', msg_obj)
                break;
            case 'Gateway.RoomUpdate.Notify':
                this._emit_room_update(msg)
                break;
        }
    }

    _encode(e, t) {
        let n = this.pb.lookup(gateway[t])
        let r = n.create(e)
        let err = n.verify(r)
        if (err)
            return this.emit('error', err)
        let o = n.encode(r).finish()
        return o
    }

    _decode(e, t) {
        let n = this.pb.lookup(gateway[t])
        let r = n.decode(e, e.byteLength)
        let err = n.verify(r);
        if (err)
            return this.emit('error', err)
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