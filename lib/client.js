window.__ModuleLoader__.load({
	id: "dsh-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		var React = require("react");

		// ---- styles (injected once, removed on HMR reload by the harness) ----
		var TAG_ID = "dsh-balance/client";
		var CSS = [
			'.dsb-badge{display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;padding:5px 12px;margin:0 0 2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#98a0aa);white-space:nowrap;user-select:none;cursor:pointer;border:none;background:transparent;border-radius:8px;text-align:left;transition:background .12s ease,color .12s ease}',
			'.dsb-badge:hover{background:var(--dsw-alias-bg-hover,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,#e8e8e8)}',
			'.dsb-badge .dsb-dot{width:6px;height:6px;border-radius:50%;flex:none}',
			'.dsb-badge[data-status="ok"] .dsb-dot{background:var(--dsw-alias-state-success-primary,#3fb68b)}',
			'.dsb-badge[data-status="error"] .dsb-dot{background:var(--dsw-alias-state-error-primary,#e5484d)}',
			'.dsb-badge[data-status="loading"] .dsb-dot{background:var(--dsw-alias-label-caption,#9aa1aa);animation:dsb-pulse 1.2s ease-in-out infinite}',
			'@keyframes dsb-pulse{0%,100%{opacity:1}50%{opacity:.25}}',
			'.dsb-badge .dsb-label{overflow:hidden;text-overflow:ellipsis}',
			'.dsb-badge[data-rail="true"]{justify-content:center;padding:5px 8px;width:auto;text-align:center}'
		].join("");
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + TAG_ID + '"]') === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "dsh-balance";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/** How often the badge re-fetches the balance (ms). */
		var REFRESH_MS = 120000;
		/** Host route serving the proxied balance. */
		var BALANCE_URL = "/ds-balance/balance";
		/** DeepSeek platform usage page, opened on click. */
		var PLATFORM_USAGE_URL = "https://platform.deepseek.com/usage";

		/** Format a money value with a currency symbol. */
		function formatMoney(value, currency) {
			var n = Number(value);
			if (!Number.isFinite(n)) return value === undefined || value === null ? "–" : String(value);
			var s = n.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
			if (currency === "CNY") return "¥" + s;
			if (currency === "USD") return "$" + s;
			return currency ? currency + " " + s : s;
		}

		/** Compact amount for the collapsed rail (no trailing zeros). */
		function compactMoney(value, currency) {
			var n = Number(value);
			if (!Number.isFinite(n)) return "–";
			var s = n.toLocaleString("zh-CN", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
			if (currency === "CNY") return "¥" + s;
			if (currency === "USD") return "$" + s;
			return currency ? currency + " " + s : s;
		}

		/** Time of day, e.g. 14:32:05. */
		function clock(iso) {
			if (typeof iso !== "string") return "";
			try {
				return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false });
			} catch {
				return "";
			}
		}

		/** Human-friendly "days left" text, e.g. "约 23 天" / "约 2 个月" / "约 1.2 年". */
		function daysText(days) {
			var n = Number(days);
			if (!Number.isFinite(n)) return "";
			if (n < 1) return "不足 1 天";
			if (n < 60) return "约 " + Math.round(n) + " 天";
			if (n < 730) return "约 " + Math.round(n / 30) + " 个月";
			return "约 " + (n / 365).toFixed(1) + " 年";
		}

		/** Calendar date of an ISO timestamp, e.g. 2025-05-30. */
		function dateText(iso) {
			if (typeof iso !== "string") return "";
			var d = new Date(iso);
			if (Number.isNaN(d.getTime())) return "";
			return d.toISOString().slice(0, 10);
		}

		/**
		* Sidebar footer badge: a dot + balance line rendered directly above the
		* settings control. Wide mode shows "余额 ¥xx.xx"; the collapsed rail shows
		* a compact amount. Hovering shows the breakdown, click opens the platform
		* usage page.
		*/
		function BalanceBadge(props) {
			var wide = props.wide !== false;
			var initial = { status: "loading", data: null, message: "" };
			var statePair = React.useState(initial);
			var state = statePair[0];
			var setState = statePair[1];

			var fetchBalance = React.useCallback(function () {
				fetch(BALANCE_URL, { headers: { Accept: "application/json" } })
					.then(function (res) {
						return res.json().catch(function () {
							return { ok: false, error: "bad-response" };
						});
					})
					.then(function (payload) {
						setState({
							status: payload && payload.ok === true ? "ok" : "error",
							data: payload || null,
							message: payload && payload.ok === true ? "" : String((payload && payload.error) || "unknown")
						});
					})
					.catch(function (error) {
						setState({ status: "error", data: null, message: error instanceof Error ? error.message : String(error) });
					});
			}, []);

			React.useEffect(function () {
				fetchBalance();
				var timer = setInterval(fetchBalance, REFRESH_MS);
				return function () { clearInterval(timer); };
			}, [fetchBalance]);

			var label, title;
			if (state.status === "loading") {
				label = "余额 …";
				title = "正在查询 DeepSeek 账户余额…";
			} else if (state.status === "error") {
				label = "余额 –";
				title = state.data && state.data.error === "not-configured"
					? "未配置 DeepSeek API Key（DEEPSEEK_API_KEY）。点击打开平台用量/充值页面。"
					: "余额查询失败：" + state.message;
			} else {
				var info = state.data && state.data.balance_infos && state.data.balance_infos[0];
				if (info === undefined) {
					label = "余额 –";
					title = "未返回余额信息";
				} else {
					var total = formatMoney(info.total_balance, info.currency);
					var compact = compactMoney(info.total_balance, info.currency);
					var est = state.data && state.data.estimation;
					var suffix = est && est.available === true ? " · " + daysText(est.daysLeft) : "";
					label = wide ? "余额 " + total + suffix : compact;
					var parts = [];
					if (info.topped_up_balance !== undefined && info.topped_up_balance !== null) parts.push("充值 " + formatMoney(info.topped_up_balance, info.currency));
					if (info.granted_balance !== undefined && info.granted_balance !== null && Number(info.granted_balance) !== 0) parts.push("赠送 " + formatMoney(info.granted_balance, info.currency));
					var updated = clock(state.data.fetchedAt);
					title = "余额 " + total + (parts.length > 0 ? "（" + parts.join(" · ") + "）" : "") + (updated ? " · 更新于 " + updated : "") + "。";
					if (est && est.available === true) {
						var when = dateText(est.depletedAt);
						title += "预计 " + (when || "近期") + " 耗尽（" + daysText(est.daysLeft) + "）· 日均消耗 " + formatMoney(est.dailySpend, info.currency) + " · 基于最近 " + Math.round(est.basedOnDays) + " 天";
					} else if (est && est.available === false) {
						title += " 余额历史不足，暂无法估算耗尽时间";
					}
					title += " 点击打开平台用量页面。";
				}
			}

			return React.createElement("button", {
				type: "button",
				className: "dsb-badge",
				"data-status": state.status,
				"data-rail": wide ? "false" : "true",
				title: title,
				onClick: function () {
					window.open(PLATFORM_USAGE_URL, "_blank", "noopener");
				}
			}, React.createElement("span", { className: "dsb-dot" }), React.createElement("span", { className: "dsb-label" }, label));
		}

		/** Required services (cordis fiber inject). */
		var inject = ["slots"];

		/**
		* Register the badge into the sidebar footer action list, which renders
		* directly above the settings control (sidebar.footer.action is a list
		* slot; order 0 puts the badge first).
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(function () {
				return ctx.slots.register({
					name: "sidebar.footer.action",
					id: "ds-balance",
					order: 0
				}, BalanceBadge);
			}, "dsh-balance: badge registration");
		}

		exports.BalanceBadge = BalanceBadge;
		exports.apply = apply;
		exports.inject = inject;
		exports.name = "dsh-balance";
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map