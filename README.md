# EventEmitter - 事件与观察者系统

## 简介

EventEmitter 是一个基于 **Godot Signal（信号机制）设计思想** 扩展出来的 TypeScript 事件通信框架。

参考 Godot Engine 中：

- Signal 信号连接
- emit 发射
- connect 监听
- disconnect 移除

的设计理念，在 JavaScript / TypeScript 环境中实现了一套：

- 类型安全事件系统
- 响应式数据观察
- 自动生命周期管理
- 批量监听解绑

适用于：

- Cocos Creator
- Web 游戏
- 前端应用
- Node.js
- TypeScript 项目

---

# 核心模块

包含三个主要组件：

## 1. SignalEmitter

基础事件总线。

功能：

- on 注册监听
- once 一次监听
- off 移除监听
- emit 发送事件
- target 批量解绑

示例：

```ts
const bus = new SignalEmitter();
bus.on("login", this, id => {
	console.log(id);
});
bus.emit("login", 1001);
```

---

# 2. SignalObserver

响应式数据观察者。

类似：

- Vue Reactive
- Godot Property Signal

当数据变化时自动派发事件。

示例：

```ts
const state = new SignalObserver({
	hp: 100,
});

state.watchByKey(
	"hp",
	(newValue, oldValue) => {
		console.log(oldValue, newValue);
	},
	this,
);

state.updateValueByKey("hp", 80);
```

输出：

```

100 -> 80

```

---

# 3. Typed Signal

类型安全事件。

通过泛型约束事件参数。

示例：

```ts
type GameEvents = {
	damage: [number, string];
};

const event = new SignalEmitter<GameEvents>();

event.on("damage", event, (damage, name) => {
	console.log(damage, name);
});
```

错误示例：

```ts
event.emit("damage", "abc");

// 类型错误
```

---

# 设计特点

## 1. Signal 思想

事件拥有唯一名字：

```
player_dead
level_complete
login
```

监听：

```
connect
```

触发：

```
emit
```

---

## 2. 生命周期管理

支持：

```ts
bus.offAllByTarget(this);
```

组件销毁时自动释放监听。

避免：

- 内存泄漏
- 重复回调

---

# Observer 数据监听

支持：

## 单属性监听

```ts
watchByKey("hp", callback);
```

事件：

```
changeKey_hp
```

参数：

```
(newValue,oldValue, key)
```

---

## 全局监听

```ts
watchAll(callback);
```

参数：

```
(allData,newValue,oldValue,key)
```

---

# 特性

| 功能               | 支持 |
| ------------------ | ---- |
| TypeScript类型提示 | √    |
| 事件发布订阅       | √    |
| 一次性监听         | √    |
| 批量解绑           | √    |
| this绑定           | √    |
| 响应式数据         | √    |
| 深度比较           | √    |
| 对象生命周期管理   | √    |

---

# 使用场景

## 游戏开发

例如：

玩家死亡：

```ts
event.emit("playerDead");
```

UI监听：

```ts
event.on("playerDead", this, showGameOver);
```

---

## 前端状态管理

替代简单：

- EventBus
- Redux部分场景
- Vue watch

---

# 注意事项

## 回调引用

不要：

```ts
bus.on("test", this, () => {});
```

因为无法使用引用移除。

推荐：

```ts
private onTest(){
   let a=5
}
bus.on("test",this,this.onTest)
```

---

# 许可证

MIT License

---

# 作者说明

本项目设计思想来源于：

Godot Engine Signal 信号系统

并结合 TypeScript 泛型能力进行扩展。

目标：

让复杂项目中的模块通信更加简单、可靠、可维护。
