const quanmin_danmu = require('./index')
const roomid = '2333'
const client = new quanmin_danmu(roomid)

client.on('connect', () => {
    console.log(`已连接quanmin ${roomid}房间弹幕~`)
})

client.on('message', msg => {
    switch (msg.type) {
        case 'chat':
            console.log(`[${msg.from.name}]:${msg.content}`)
            break
        case 'gift':
            console.log(`[${msg.from.name}]->赠送${msg.count}个${msg.name}`)
            break
        case 'zhongzi':
            console.log(`[${msg.from.name}]->赠送${msg.count}个${msg.name}`)
            break
        case 'fight':
            console.log(`[当前战斗力]:${msg.count}`)
            break
        case 'online':
            console.log(`[当前人气]:${msg.count}`)
            break
    }
})

client.on('error', e => {
    console.log(e)
})

client.on('close', () => {
    console.log('close')
})

client.start()