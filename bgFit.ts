enum selectModelType {
	"以改变宽高的形式" = 1,
	"以改变scale的形式" = 2,
}
enum selectSizeType {
	"以图片大小为初始尺寸" = 1,
	"以设定大小为初始尺寸" = 2,
}
enum selectShowType {
	"铺满屏幕优先" = 1,
	"内容完全优先" = 2,
}
const { ccclass, property, disallowMultiple, executeInEditMode, requireComponent } = cc._decorator;
@ccclass
@executeInEditMode()
@disallowMultiple()
export default class bgFit extends cc.Component {
	@property({ type: cc.Enum(selectModelType), displayName: "适配模式" })
	_modelType: selectModelType = selectModelType["以改变scale的形式"];

	@property({ type: cc.Enum(selectSizeType), displayName: "初始尺寸" })
	_sizeType: selectSizeType = selectSizeType["以设定大小为初始尺寸"];

	@property({ type: cc.Enum(selectShowType), displayName: "显示模式" })
	_showType: selectShowType = selectShowType["内容完全优先"];

	@property({ displayName: "初始宽度" })
	_orWidth: number = 0;

	@property({ displayName: "初始高度" })
	_orHeight: number = 0;

	@property({ displayName: "初始scaleX" })
	_orScaleX: number = 0;

	@property({ displayName: "初始scaleY" })
	_orScaleY: number = 0;

	@property({ type: cc.Enum(selectModelType), displayName: "适配模式" })
	set modelType(type: selectModelType) {
		this._modelType = type;
		this.autoSize();
	}
	get modelType() {
		return this._modelType;
	}

	@property({ type: cc.Enum(selectSizeType), displayName: "初始尺寸" })
	set sizeType(type: selectSizeType) {
		this._sizeType = type;
		this.autoSize();
	}
	get sizeType() {
		return this._sizeType;
	}

	@property({ type: cc.Enum(selectShowType), displayName: "显示模式" })
	set showType(type: selectShowType) {
		this._showType = type;
		this.autoSize();
	}
	get showType() {
		return this._showType;
	}
	@property({
		type: cc.Float,
		displayName: "初始宽度",
		visible() {
			return this.sizeType == selectSizeType["以设定大小为初始尺寸"];
		},
	})
	set orWidth(number: number) {
		if (!number || number <= 0) {
			if (CC_EDITOR || CC_PREVIEW) cc.warn("初始宽度必须大于0");
			return;
		}
		this._orWidth = number;
		this.autoSize();
	}
	get orWidth() {
		return this._orWidth;
	}

	@property({
		type: cc.Float,
		displayName: "初始高度",
		visible() {
			return this.sizeType == selectSizeType["以设定大小为初始尺寸"];
		},
	})
	set orHeight(number: number) {
		if (!number || number <= 0) {
			if (CC_EDITOR || CC_PREVIEW) cc.warn("初始高度必须大于0");
			return;
		}
		this._orHeight = number;
		this.autoSize();
	}
	get orHeight() {
		return this._orHeight;
	}

	@property({ type: cc.Float, displayName: "初始scaleX" })
	set orScaleX(number: number) {
		if (!number || number <= 0) {
			if (CC_EDITOR || CC_PREVIEW) cc.warn("初始scaleX必须大于0");
			return;
		}
		this._orScaleX = number;
		this.autoSize();
	}
	get orScaleX() {
		return this._orScaleX;
	}

	@property({ type: cc.Float, displayName: "初始scaleY" })
	set orScaleY(number: number) {
		if (!number || number <= 0) {
			if (CC_EDITOR || CC_PREVIEW) cc.warn("初始scaleY必须大于0");
			return;
		}
		this._orScaleY = number;
		this.autoSize();
	}
	get orScaleY() {
		return this._orScaleY;
	}
	onLoad() {}
	protected onEnable(): void {
		if (this.node.parent) {
			this.node.parent.on(cc.Node.EventType.SIZE_CHANGED, this.autoSize, this);
		}
		this.autoSize();
	}
	protected onDisable(): void {
		if (this.node.parent) {
			this.node.parent.off(cc.Node.EventType.SIZE_CHANGED, this.autoSize, this);
		}
	}
	start() {}
	autoSize() {
		try {
			if (!this.node.parent) {
				if (CC_EDITOR || CC_PREVIEW) cc.warn("[bgFit] 节点缺少父节点");
				return;
			}
			if (CC_EDITOR && this.node.parent.name == "New Node" && !this.node.parent.parent) {
				return;
			}
			// 检查并获取 spriteFrame
			const sprite = this.node.getComponent(cc.Sprite);
			const spriteFrame = sprite?.spriteFrame;
			if (this.sizeType == selectSizeType.以图片大小为初始尺寸 && !spriteFrame) {
				throw new Error("当前使用图片大小模式，但缺少图片资源");
			}

			// 检查组件冲突
			const widget = this.getComponent(cc.Widget);
			if (widget?.enabled && ((widget.isAlignLeft && widget.isAlignRight) || (widget.isAlignTop && widget.isAlignBottom)) && this.modelType == 1) {
				throw new Error("当前模式与 Widget 组件设置冲突，请检查对齐方式");
			}

			const layout = this.getComponent(cc.Layout);
			if (layout?.enabled && layout.resizeMode == cc.Layout.ResizeMode.CONTAINER && this.modelType == 1) {
				throw new Error("当前模式与 Layout 组件设置冲突，请检查 resizeMode");
			}

			if (!this._orWidth || this._orWidth <= 0) {
				throw new Error("初始宽度必须大于0");
			}
			if (!this._orHeight || this._orHeight <= 0) {
				throw new Error("初始高度必须大于0");
			}
			if (!this._orScaleX || this._orScaleX <= 0) {
				throw new Error("初始scaleX必须大于0");
			}
			if (!this._orScaleY || this._orScaleY <= 0) {
				throw new Error("初始scaleY必须大于0");
			}

			// 还原节点初始状态
			this.node.scaleX = this._orScaleX;
			this.node.scaleY = this._orScaleY;
			this.node.width = this._orWidth;
			this.node.height = this._orHeight;

			// 获取目标尺寸
			let targetWidth = this._orWidth;
			let targetHeight = this._orHeight;
			if (this.sizeType == selectSizeType.以图片大小为初始尺寸 && spriteFrame) {
				const size = spriteFrame.getRect();
				targetWidth = size.width;
				targetHeight = size.height;
			}

			// 计算缩放比例
			const parentSize = this.node.parent.getContentSize();
			const scaleX = parentSize.width / (targetWidth * this.node.scaleX);
			const scaleY = parentSize.height / (targetHeight * this.node.scaleY);

			// 根据显示模式选择缩放比例
			let finalScale =
				this.showType == selectShowType.铺满屏幕优先
					? Math.max(scaleX, scaleY) // 铺满屏幕优先
					: Math.min(scaleX, scaleY); // 内容完全优先

			// 应用缩放
			if (this.modelType == selectModelType.以改变宽高的形式) {
				this.node.width = targetWidth * finalScale;
				this.node.height = targetHeight * finalScale;
			} else {
				this.node.scaleX = this._orScaleX * finalScale;
				this.node.scaleY = this._orScaleY * finalScale;
			}
			//这里打印下当前节点的路径
			let path = this.node.name;
			let tempNode = this.node;
			while (tempNode.parent) {
				tempNode = tempNode.parent;
				path = tempNode.name + "/" + path;
			}
			if (CC_EDITOR || CC_PREVIEW) cc.log(`[${path}]适配完成 - 模式:${this.modelType}, 最终比例:${finalScale}`);
		} catch (error) {
			if (CC_EDITOR || CC_PREVIEW) cc.error("[bgFit]", error);
		}
	}
	// update(dt) {}
}
