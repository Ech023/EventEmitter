const inflightMethodStatusMap: Map<object, Map<Function, number>> = new Map();

/**
 * 异步方法防重入装饰器（阻止重复调用）
 * 作用：异步函数执行完成前（resolve/reject），拒绝后续的重复调用
 * 适用：所有异步方法（async/await），实例方法/静态方法均支持
 * @param target 类原型（实例方法）/类本身（静态方法）
 * @param methodName 被装饰的方法名称
 * @param descriptor 方法的属性描述符
 * @returns 包装后的属性描述符
 */
export function preventReentry(target: any, methodName: string, descriptor: PropertyDescriptor): PropertyDescriptor {
	// 保存原始方法引用
	const originalMethod = descriptor.value;
	descriptor.value = async function (...args: unknown[]) {
		let instanceMethodMap = inflightMethodStatusMap.get(this);
		try {
			if (!instanceMethodMap) {
				instanceMethodMap = new Map();
				inflightMethodStatusMap.set(this, instanceMethodMap);
			}

			// 检查方法是否正在执行，若正在执行则拒绝本次调用
			let count = instanceMethodMap.get(originalMethod);
			if (count) {
				count++;
				instanceMethodMap.set(originalMethod, count);
				if (count > 1) {
					cc["esp"].utils.createTBox("请勿重复点击");
				}
				console.warn(`[preventReentry] 方法 ${methodName} 正在执行，已拒绝${count - 1}次重复调用`);
				return;
			}
			// 标记方法为「正在执行」状态
			instanceMethodMap.set(originalMethod, 1);
			// 执行原始方法并透传返回值
			const res = await originalMethod.apply(this, args);
			return res;
		} catch (error) {
			// 透传异常，不影响外层捕获逻辑
			throw error;
		} finally {
			// 无论成功/失败，都移除「正在执行」标记
			instanceMethodMap?.delete(originalMethod);
			// 若实例下无任何执行中的方法，清理该实例的状态映射（优化内存）
			if (!instanceMethodMap?.size) {
				inflightMethodStatusMap.delete(this);
			}
		}
	};
	return descriptor;
}
