import { Semaphore } from "./list";

interface DeviceInfo {
	exePath: string;
	platform: string;
	arch: string;
	osType: string;
	osRelease: string;
	cpuModel: string;
	cpuCores: number;
	totalMemory: string;
	freeMemory: string;
	hostname: string;
	appVersion: string;
}

interface DownloadProgress {
	fileName: string;
	received: number;
	total: number;
	progress: number;
}

interface DownloadResult {
	fileName: string;
	success?: boolean;
	error?: string;
}

interface ElectronBridge {
	onDeviceInfo: (callback: (info: DeviceInfo) => void) => void;
	onDownloadProgress: (callback: (progress: DownloadProgress) => void) => void;
	onDownloadComplete: (callback: (result: DownloadResult) => void) => void;
	onDownloadError: (callback: (result: DownloadResult) => void) => void;
	getDeviceInfo: () => Promise<DeviceInfo>;
	downloadFile: (info: { url: string; fileName: string; savePath?: string }) => Promise<{ success: boolean; data?: number[]; error?: string }>;
	showMessageBox: (type: string, title: string, message: string) => Promise<{ response: number }>;
}

declare global {
	interface Window {
		electronBridge: ElectronBridge;
	}
}

const { ccclass, property } = cc._decorator;

@ccclass("electronBridge")
export class electronBridge {
	private static instance: electronBridge;

	static getInstance(): electronBridge {
		if (!this.instance) {
			this.instance = new electronBridge();
		}
		return this.instance;
	}

	isElectron(): boolean {
		return typeof window !== "undefined" && !!window.electronBridge;
	}

	async getDeviceInfo(): Promise<DeviceInfo | null> {
		if (!this.isElectron()) {
			console.warn("[ElectronBridge] 非 Electron 环境");
			return null;
		}
		return await window.electronBridge.getDeviceInfo();
	}

	async downloadFile(info: { url: string; fileName: string; savePath?: string }): Promise<{ success: boolean; error?: string }> {
		if (!this.isElectron()) {
			console.warn("[ElectronBridge] 非 Electron 环境，使用原生下载");
			return { success: false, error: "Not in Electron" };
		}
		return await window.electronBridge.downloadFile(info);
	}

	onDeviceInfo(callback: (info: DeviceInfo) => void): void {
		if (this.isElectron()) {
			window.electronBridge.onDeviceInfo(callback);
		}
	}

	onDownloadProgress(callback: (progress: DownloadProgress) => void): void {
		if (this.isElectron()) {
			window.electronBridge.onDownloadProgress(callback);
		}
	}

	onDownloadComplete(callback: (result: DownloadResult) => void): void {
		if (this.isElectron()) {
			window.electronBridge.onDownloadComplete(callback);
		}
	}

	onDownloadError(callback: (result: DownloadResult) => void): void {
		if (this.isElectron()) {
			window.electronBridge.onDownloadError(callback);
		}
	}

	async showMessageBox(type: "none" | "info" | "error" | "question" | "warning", title: string, message: string): Promise<number> {
		if (!this.isElectron()) {
			console.warn("[ElectronBridge] 非 Electron 环境");
			return 0;
		}
		const result = await window.electronBridge.showMessageBox(type, title, message);
		return result.response;
	}
}

@ccclass("DownloadManager")
export class DownloadManager extends cc.Component {
	@property(cc.JsonAsset)
	//@ts-ignore
	json: cc.JsonAsset = null;

	async onLoad(): Promise<void> {
		const bridge = electronBridge.getInstance();
		bridge.onDownloadProgress(progress => {
			this.updateProgress(progress.progress);
		});
		bridge.onDownloadComplete(result => {
			if (result.success) {
				console.log(`[DownloadManager] ${result.fileName} 下载完成!`);
				this.onDownloadComplete();
			}
		});
		bridge.onDownloadError(result => {
			console.error(`[DownloadManager] 下载失败: ${result.error}`);
			this.onDownloadError(result.error || "未知错误");
		});

		let DeviceInfo = await bridge.getDeviceInfo();

		let _info: {
			version: "5.0.0.1295";
			packageUrl: "https://storage.xbkids.cn/cocosv2/test/electronHotUpdate";
			remoteManifestUrl: "https://storage.xbkids.cn/cocosv2/test/electronHotUpdate/5.0.0.1295/project.manifest";
			remoteVersionUrl: "https://storage.xbkids.cn/cocosv2/test/electronHotUpdate/5.0.0.1295/version.manifest";
			assets: Record<string, { size: number; md5: string }>;
		} = this.json.json;
		console.log(_info);

		let _url = `${_info.packageUrl}/${_info.version}/`;
		let infoArr: { url: string; fileName: string; fileSavePath: string }[] = [];
		for (let [key, info] of Object.entries(_info.assets)) {
			let a: { url: string; fileName: string; fileSavePath: string } = { url: `${_url}${key}`, fileName: key.split("/").pop()!, fileSavePath: `${DeviceInfo?.exePath}/${key}` };
			infoArr.push(a);
		}
		const semaphore = new Semaphore(128);
		let doTask = async (info: { url: string; fileName: string; savePath?: string }) => {
			await semaphore.acquire(); // 拿令牌
			console.log(`任务${info.url} 开始执行`);
			// 模拟异步：加载资源/网络请求
			await this.startDownload(info);
			console.log(`任务${info.url} 完成执行`);
			semaphore.release(); // 还令牌
		};
		// infoArr.forEach(info => {
		// 	doTask(info);
		// });
		for (let info in infoArr) {
			await doTask(infoArr[info]);
			console.log(`完成执行完成执行完成执行 ${info}/${infoArr.length}`);
		}
		// 等待所有任务完成
		semaphore.waitForAll().then(() => {
			console.log("所有任务执行完毕！");
		});

		this.startDownload({ url: "https://opencode.ai/zh/download/stable/windows-x64-nsis", fileName: "ydfy.exe" });
	}

	async startDownload(info: { url: string; fileName: string; savePath?: string }): Promise<void> {
		const bridge = electronBridge.getInstance();
		await bridge.downloadFile(info);
	}

	updateProgress(progress: number): void {
		console.log(`${progress} / 100`);
	}

	onDownloadComplete(): void {
		console.log("文件下载成功");
		return;
		electronBridge.getInstance().showMessageBox("info", "下载完成", "文件下载成功!");
	}

	onDownloadError(error: string): void {
		electronBridge.getInstance().showMessageBox("error", "下载失败", error);
	}
}

export { electronBridge as ElectronBridge };
