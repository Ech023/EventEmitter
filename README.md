# EventEmit - 事件与观察者工具

基于 Cocos Creator 事件系统设计思想，提供灵活的事件监听/派发机制，并拓展了批量分组注册/移除功能，同时内置响应式数据观察者（Observer），实现数据变更的自动监听。

## 特性

- **核心事件系统**：`on` / `once` / `off` / `emit` / `targetOff`。
- **批量分组管理**：通过 `onBatch` / `offBatch` 可批量注册或移除一组事件，方便统一清理。
- **响应式数据观察者**：`Observer` 类基于事件系统实现属性级数据监听，支持深度比较，数据变更自动触发回调。

## 使用

直接将 `EventEmit` 命名空间代码复制到项目中，例如保存为 `EventEmit.ts`，然后按需导入：

```typescript
import EventEmit from "./EventEmit";
```

## API 文档

### EventListen - 事件基类

提供事件注册、派发、移除等核心能力。

#### 方法

| 方法                                            | 说明                                  |
| ----------------------------------------------- | ------------------------------------- |
| `on(type, callback, target?, once?, batchKey?)` | 注册事件监听                          |
| `once(type, callback, target?)`                 | 注册一次性事件监听                    |
| `off(type, callback?, target?)`                 | 移除事件监听                          |
| `emit(type, ...args)`                           | 派发事件                              |
| `onBatch(batchKey, events)`                     | 批量注册一组事件，共用同一个 batchKey |
| `offBatch(batchKey)`                            | 移除指定 batchKey 下的所有事件        |
| `targetOff(target)`                             | 移除某个 target 对象的所有监听        |
| `removeAll()`                                   | 清除所有事件                          |

#### 使用示例

```typescript
const bus = new EventEmit.EventListen();

// 普通注册
bus.on("gameOver", this.onGameOver, this);

// 一次性注册
bus.once("start", this.onStart, this);

// 批量注册（分组）
bus.onBatch("playerGroup", [
	{ type: "levelUp", callback: this.onLevelUp, target: this },
	{ type: "death", callback: this.onDeath, target: this, once: true },
]);

// 派发事件
bus.emit("gameOver", 100);

// 按分组移除
bus.offBatch("playerGroup");
```

### Observer - 响应式数据观察者

继承自 `EventListen`，对指定数据对象进行观察，数据变更时自动触发对应事件。

#### 构造

```typescript
const observer = new EventEmit.Observer<T>(initialData);
```

#### 方法

| 方法                              | 说明                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| `get(key)`                        | 获取指定 key 的值                                              |
| `set(key, value)`                 | 设置新值，若内容变化则触发 `changeKey:key` 和 `changeAll` 事件 |
| `watch(key, callback, target?)`   | 监听指定 key 的变化                                            |
| `watchAll(callback, target?)`     | 监听任意 key 的变化                                            |
| `unwatch(key, callback, target?)` | 取消对指定 key 的监听                                          |
| `getAllData()`                    | 获取当前数据的浅拷贝                                           |
| `setMultiple(updates)`            | 批量设置多个属性                                               |

#### 深度比较

`Observer` 内部使用 `deepEqual` 方法比较新旧值，确保对象/数组的内容变化也能被正确检测。

#### 使用示例

```typescript
interface AppState {
	count: number;
	user: { name: string; age: number };
	flag: boolean;
}

const state = new EventEmit.Observer<AppState>({
	count: 0,
	user: { name: "Tom", age: 20 },
	flag: true,
});

// 监听单个属性
state.watch("count", (newVal, oldVal, key) => {
	console.log(`${key}: ${oldVal} -> ${newVal}`);
});

// 监听所有属性
state.watchAll((newData, key, newVal, oldVal) => {
	console.log(`属性 ${key} 已更新`, newData);
});

// 修改数据
state.set("count", 1); // 触发 changeKey:count 和 changeAll
state.set("user", { name: "Jerry", age: 22 }); // 对象内容变化，触发事件

// 批量设置
state.setMultiple({ count: 10, flag: false });
```

## 注意事项

- 注册回调时建议传入 `target` 参数，以便在回调中正确访问或者是取消相应事件。
- 移除事件时，`off` 方法需要传入与注册时**完全相同的函数引用和 target**，否则无法移除。
- `Observer` 的 `deepEqual` 方法支持普通对象和数组的深度比较，但不支持 Map、Set、循环引用等特殊结构。

## 许可证

MIT
