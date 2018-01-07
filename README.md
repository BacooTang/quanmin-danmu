# quanmin-danmu

quanmin-danmu 是Node.js版全民直播弹幕监听模块。

简单易用，使用不到三十行代码，你就可以使用Node.js基于弹幕进一步开发。

## Installation

可以通过本命令安装 quanmin-danmu:

```bash
npm install quanmin-danmu --save
```

## Simple uses

通过如下代码，可以初步通过Node.js对弹幕进行处理。

```javascript
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
```

## API

### 开始监听弹幕

```javascript
const quanmin_danmu = require('quanmin-danmu')
const roomid = '8242492'
const client = new quanmin_danmu(roomid)
client.start()
```

### 使用socks5代理监听

```javascript
const quanmin_danmu = require('quanmin-danmu')
const roomid = '80000'
const proxy = 'socks://name:pass@127.0.0.1:1080'
const client = new quanmin_danmu({roomid,proxy})
client.start()
```

### 停止监听弹幕

```javascript
client.stop()
```

### 监听事件

```javascript
client.on('connect', _ => {
    console.log('connect')
})

client.on('message', console.log)

client.on('error', console.log)

client.on('close', _ => {
    console.log('close')
})
```

### msg对象

msg对象type有chat,gift,zhongzi,online,fight五种值
分别对应聊天内容、礼物、种子、人气、战斗力

#### chat消息
```javascript
    {
        type: 'chat',
        time: '毫秒时间戳(服务器无返回time,此处为本地收到消息时间),Number',
        from: {
            name: '发送者昵称,String',
            rid: '发送者rid,String',
            level: '发送者等级,Number',
            plat: '发送者平台(android,ios,pc_web,unknow),String'
        },
        id: '弹幕唯一id,String',
        content: '聊天内容,String'
    }
```

#### gift消息
```javascript
    {
        type: 'gift',
        time: '毫秒时间戳,Number',
        name: '礼物名称,String',
        from: {
            name: '发送者昵称,String',
            rid: '发送者rid,String',
            level: '发送者等级,Number'
        },
        id: '礼物唯一id,String',
        count: '礼物数量,Number',
        price: '礼物总价值(单位牛币),Number',
        earn: '礼物总价值(单位元),Number'
    }
```

#### zhongzi消息
```javascript
    {
        type: 'zhongzi',
        time: '毫秒时间戳,Number',
        name: '礼物名称,String',
        from: {
            name: '发送者昵称,String',
            rid: '发送者rid,String',
            level: '发送者等级,Number'
        },
        id: '礼物唯一id,String',
        count: '礼物数量,Number'
    }
```

#### online消息
```javascript
    {
        type: 'online',
        time: '毫秒时间戳(服务器无返回time,此处为本地收到消息时间),Number',
        count: '当前人气值,Number'
    }
```

#### fight消息
```javascript
    {
        type: 'fight',
        time: '毫秒时间戳(服务器无返回time,此处为本地收到消息时间),Number',
        count: '当前战斗力,Number'
    }
```

#### room消息
```javascript
    {
        type: 'room',
        time: '毫秒时间戳(服务器无返回time,此处为本地收到消息时间),Number',
        online: '当前人气值,Number',
        fight: '当前战斗力,Number',
    }
```
