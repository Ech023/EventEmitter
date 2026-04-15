# EventEmit - 事件与观察者工具

基于 Cocos Creator 事件系统设计思想，核心语法基于 ES6（ECMAScript 2015），但外层使用了 TypeScript 类型系统，提供灵活的事件监听/派发机制，并拓展了批量分组注册/移除功能，同时内置响应式数据观察者（Observer），实现数据变更的自动监听，和能够通过接口智能提示的相关注册派发的事件(TypedEventListen)

## 概述

事件系统提供三个核心类：

- **EventListen**：基础事件总线（订阅/发布/批量管理）
- **Observer**：响应式数据观察者（基于 EventListen）
- **TypedEventListen**：类型安全的事件总线（泛型约束）

所有事件回调均**异步执行**（微任务），支持自动绑定 `this`、一次性监听、批量分组、深度比较等特性。

---

## 1. EventListen

基础事件类，实现事件的订阅、发布、取消、批量管理。

### 构造函数

```typescript
new EventListen();
```

### 方法

#### on(eventKey, callback, target?, batchKey?)

订阅事件（永久监听）。

| 参数     | 类型     | 必填 | 说明                   |
| -------- | -------- | ---- | ---------------------- |
| eventKey | string   | 是   | 事件名称               |
| callback | Function | 是   | 回调函数               |
| target   | any      | 否   | 绑定 `this` 的对象     |
| batchKey | string   | 否   | 分组标识，用于批量取消 |

```typescript
const emitter = new EventListen();
emitter.on("greet", name => console.log(name));
emitter.on(
	"click",
	function () {
		console.log(this.id);
	},
	{ id: "btn" },
);
```

#### once(eventKey, callback, target?)

订阅一次性事件（触发后自动移除）。

```typescript
emitter.once("init", () => console.log("只执行一次"));
```

#### onBatch(batchKey, events)

批量订阅，统一分组。

| 参数     | 类型                                | 说明         |
| -------- | ----------------------------------- | ------------ |
| batchKey | string                              | 分组标识     |
| events   | Array<{eventKey, callback, target}> | 事件配置数组 |

```typescript
emitter.onBatch("playerGroup", {
	levelUp: { callback: this.onLevelUp, target: this },
	death: { callback: this.onDeath, target: this },
});
```

#### offBatch(batchKey)

取消指定分组的所有事件。

#### off(eventKey, callback?, target?)

取消事件订阅。

- 不传 `callback`：移除该事件类型的所有监听
- 传 `callback` 和可选的 `target`：精确移除匹配的监听

#### targetOff(target)

取消指定对象（`target`）绑定的所有事件。

#### hasListeners(eventKey)

判断是否存在监听器。返回 `boolean`。

#### emit(eventKey, ...args)

发布事件（异步微任务）。参数会传递给回调函数。

```typescript
emitter.emit("score", 100, "level2");
```

#### clear()

清空所有事件与队列。

#### getAllListeners()

获取所有监听器快照（只读，用于调试）。

---

## 2. Observer<T>

响应式数据观察者，继承自 `EventListen`。当通过 `updateValueByKey` 修改属性时，若存在对应监听器，会触发：

- `changeKey_属性名` 事件，参数：`(newValue, oldValue, key)`
- `changeAll` 事件，参数：`(fullData, newValue, oldValue, key)`

> **注意**：只有当 `changeKey_属性名` 存在监听器时，数据才会被实际修改。若无监听，调用 `updateValueByKey` 无效。

### 构造函数

```typescript
new Observer<T>(initialData: T)
```

### 方法

#### getValueByKey(key)

获取指定属性的值（深拷贝副本）。

#### getAllData()

获取完整数据的深拷贝副本。

#### updateValueByKey(key, value, forceEmit?)

设置属性值。`forceEmit` 为 `true` 时强制触发事件（即使值未变）。

```typescript
state.updateValueByKey("count", 10);
state.updateValueByKey("count", 10, true); // 强制触发
```

#### setMultiple(data)

批量设置数据（依次调用 `updateValueByKey`）。

#### watchByKey(key, callback, target?)

监听单个属性变化。

```typescript
state.watchByKey("count", (newVal, oldVal, key) => {
	console.log(`${key}: ${oldVal} -> ${newVal}`);
});
```

#### watchAll(callback, target?)

监听所有属性变化。

```typescript
state.watchAll((fullData, newVal, oldVal, key) => {
	console.log("数据已更新", fullData);
});
```

#### unwatch(key, callback, target?)

取消单个属性监听。

---

## 3. TypedEventListen<T>

类型安全的事件总线，包装 `EventListen`，通过泛型提供事件名和回调参数的智能提示。

### 构造函数

```typescript
new TypedEventListen<T>();
```

### 使用示例

```typescript
interface MyEvents {
	click: (x: number, y: number) => void;
	loaded: (data: string) => void;
}

const bus = new TypedEventListen<MyEvents>();

bus.on("click", (x, y) => console.log(x + y));
bus.emit("click", 10, 20);
// bus.emit('click', 'a'); // 类型错误
```

### 方法（与 EventListen 对应，但参数类型受限）

- `on(eventKey, callback, target?)`
- `once(eventKey, callback, target?)`
- `off(eventKey, callback?, target?)`
- `emit(eventKey, ...args)`
- `listens(batchKey, events)` —— 批量订阅（原名 `onBatch`，此处命名为 `listens`）
- `offBatch(batchKey)`
- `targetOff(target)`
- `clear()`
- `hasListeners(eventKey)`
- `getAllListeners()`

---

## 注意事项

1. **异步执行**：所有 `emit` 触发的回调都在微任务中执行，不会同步阻塞。
2. **自动绑定 this**：通过 `target` 参数传入对象，回调中的 `this` 会自动绑定到该对象。
3. **深度比较**：`Observer` 的 `_deepEqual` 递归深度默认为 10 层，支持 `Date`、`Map`、`Set`、`RegExp`。
4. **无监听不修改**：`Observer.updateValueByKey` 仅当存在 `changeKey_xxx` 监听时才实际修改数据，请确保先调用 `watch` 或 `watchAll`。
5. **分组标识**：`batchKey` 用于批量管理，`onBatch` 注册的事件可通过 `offBatch` 一次性移除。
6. **内存管理**：使用完记得调用 `targetOff(target)` 或 `clear()` 避免内存泄漏。

---

## 完整示例

```typescript
import EventEmitter from "./EventEmitter";

// 1. 基础事件总线
const bus = new EventEmitter.EventListen();
const handler = msg => console.log(msg);
bus.on("log", handler);
bus.emit("log", "Hello"); // 异步输出
bus.off("log", handler);

// 2. 响应式数据
const state = new EventEmitter.Observer({ count: 0 });
state.watchByKey("count", (newVal, oldVal) => {
	console.log(`count: ${oldVal} -> ${newVal}`);
});
state.updateValueByKey("count", 5); // 触发 watch

// 3. 类型安全总线
// constTypeBus.ts 全局公共事件定义脚本
import EventEmitter from "./EventEmitter";
/**全局公共接口*/
interface Events {
	move: (dx: number, dy: number) => void;
}
/**导出为公共后可在子模块注册派发*/
export const typedBus = new EventEmitter.TypedEventListen<Events>();

//子模块
import { typedBus } from "./constTypeBus";
typedBus.on("move", (dx, dy) => console.log(dx, dy));
typedBus.emit("move", 10, 20);
```

## 许可证

MIT
