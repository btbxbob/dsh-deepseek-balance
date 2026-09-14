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
			'.dsb-badge .dsb-text{display:flex;flex-direction:column;min-width:0;flex:1;line-height:1.25}',
			'.dsb-badge .dsb-main{overflow:hidden;text-overflow:ellipsis}',
			'.dsb-badge .dsb-sub{font-size:11px;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
			'.dsb-badge[data-rail="true"]{justify-content:center;padding:5px 8px;width:auto;text-align:center}',
			'.dsb-badge[data-rail="true"] .dsb-text{flex:0 0 auto;align-items:center}',
			'.dsb-badge[data-rail="true"] .dsb-sub{font-size:10px;opacity:.7}'
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

		/** Local "HH:MM" of an ISO timestamp, e.g. "23:15". */
		function clockHM(iso) {
			if (typeof iso !== "string" || iso === "") return "";
			try {
				return new Date(iso).toLocaleTimeString("zh-CN", { hour12: false, hour: "2-digit", minute: "2-digit" });
			} catch {
				return "";
			}
		}

		/** Short calendar date for an ISO timestamp, e.g. "6/22" (this year) or "2027-02". */
		function shortDate(iso) {
			if (typeof iso !== "string" || iso === "") return "";
			var d = new Date(iso);
			if (Number.isNaN(d.getTime())) return "";
			var month = d.getMonth() + 1;
			if (d.getFullYear() === new Date().getFullYear()) return month + "/" + d.getDate();
			return d.getFullYear() + "-" + (month < 10 ? "0" : "") + month;
		}

		/** Human-friendly span description, e.g. "最近 16 分钟" / "最近 3 小时" / "最近 2 天". */
		function windowText(hours) {
			var h = Number(hours);
			if (!Number.isFinite(h) || h <= 0) return "最近几次查询";
			if (h < 1) return "最近不到 1 小时";
			if (h < 24) return "最近 " + Math.max(1, Math.round(h)) + " 小时";
			return "最近 " + Math.round(h / 24) + " 天";
		}

		/**
		* Entertaining "when does it run out" line, rendered directly on the badge
		* (not only in the hover). Deliberately playful — the estimate itself is a
		* loose guess from the last few queries.
		*/
		function funEstimate(est) {
			if (!est) return null;
			if (est.available === false) return "查询次数还太少，再攒几次就能瞎猜了";
			if (!Number.isFinite(est.dailySpend) || est.dailySpend <= 0 || !Number.isFinite(est.daysLeft)) {
				return "余额纹丝不动，感觉能用到地老天荒";
			}
			var days = est.daysLeft;
			var core;
			if (days < 1) {
				var hm = clockHM(est.depletedAt);
				core = hm ? "今天 " + hm + " 见底" : "今天就要见底了";
			} else if (days < 60) core = "约 " + Math.round(days) + " 天见底";
			else if (days < 730) core = "约 " + Math.round(days / 30) + " 个月见底";
			else if (days < 3650) core = "约 " + (days / 365).toFixed(1) + " 年见底";
			else core = "还能用好多年，随便造";
			var date = shortDate(est.depletedAt);
			var text = days < 1 ? core : (date ? "预计 " + date + " 耗尽 · " + core : core);
			return text + "（" + windowText(est.windowHours) + "瞎猜）";
		}

		/** Compact one-line variant for the collapsed rail. */
		function funEstimateShort(est) {
			if (!est || est.available === false) return "…";
			if (!Number.isFinite(est.dailySpend) || est.dailySpend <= 0 || !Number.isFinite(est.daysLeft)) return "用不完";
			var days = est.daysLeft;
			if (days < 1) return "≈" + Math.max(1, Math.round(days * 24)) + "h";
			if (days < 60) return "≈" + Math.max(1, Math.round(days)) + "天";
			if (days < 730) return "≈" + Math.round(days / 30) + "月";
			if (days < 3650) return "≈" + (days / 365).toFixed(1) + "年";
			return "很久";
		}

		/**
		* Sidebar footer badge: a dot + two-line balance card rendered directly
		* above the settings control. Line 1 is the balance; line 2 is the
		* always-visible (playful) estimate of when it runs out. Hovering adds the
		* full breakdown; click opens the platform usage page.
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

			var mainLabel, subLabel, title;
			if (state.status === "loading") {
				mainLabel = "余额 …";
				title = "正在查询 DeepSeek 账户余额…";
			} else if (state.status === "error") {
				mainLabel = "余额 –";
				title = state.data && state.data.error === "not-configured"
					? "未配置 DeepSeek API Key（DEEPSEEK_API_KEY）。点击打开平台用量/充值页面。"
					: "余额查询失败：" + state.message;
			} else {
				var info = state.data && state.data.balance_infos && state.data.balance_infos[0];
				if (info === undefined) {
					mainLabel = "余额 –";
					title = "未返回余额信息";
				} else {
					var total = formatMoney(info.total_balance, info.currency);
					var compact = compactMoney(info.total_balance, info.currency);
					var est = state.data && state.data.estimation;
					mainLabel = wide ? "余额 " + total : compact;
					var parts = [];
					if (info.topped_up_balance !== undefined && info.topped_up_balance !== null) parts.push("充值 " + formatMoney(info.topped_up_balance, info.currency));
					if (info.granted_balance !== undefined && info.granted_balance !== null && Number(info.granted_balance) !== 0) parts.push("赠送 " + formatMoney(info.granted_balance, info.currency));
					var updated = clock(state.data.fetchedAt);
					title = "余额 " + total + (parts.length > 0 ? "（" + parts.join(" · ") + "）" : "") + (updated ? " · 更新于 " + updated : "") + "。";
					if (est && est.available === true) {
						var hm = clockHM(est.depletedAt);
						title += "预计 " + (shortDate(est.depletedAt) || "近期") + (hm ? " " + hm : "") + " 耗尽";
						if (Number.isFinite(est.dailySpend) && est.dailySpend > 0) {
							title += " · 日均消耗 " + formatMoney(est.dailySpend, info.currency) + " · 基于最近 " + Math.round(est.basedOnSamples) + " 次查询";
						} else {
							title += "（余额近期未下降，乐观估计）";
						}
					} else if (est && est.available === false) {
						title += " 查询次数不足，暂无法瞎猜耗尽时间";
					}
					title += " 点击打开平台用量页面。";
					subLabel = wide ? funEstimate(est) : funEstimateShort(est);
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
			}, React.createElement("span", { className: "dsb-dot" }), React.createElement("span", { className: "dsb-text" },
				React.createElement("span", { className: "dsb-main" }, mainLabel),
				subLabel ? React.createElement("span", { className: "dsb-sub" }, subLabel) : null
			));
		}

		/** Required services (cordis fiber inject). */
		var inject = ["slots"];

		/**
		* Register the badge into the sidebar footer action list, which renders
		* directly above the settings control (sidebar.footer.action is a list
		* slot; order 0 puts the badge first).
		*
		* The slot is declared by the sidebar entry, which may not have mounted
		* yet when this plugin applies — and a register() against an undeclared
		* slot fails the whole loader entry ("slot ... is not declared"). So the
		* registration waits through slots.inject, which runs now when the
		* declaration already exists and otherwise runs it as soon as the
		* declaring entry commits; the controller belongs to this fiber, so
		* unload cancels a pending wait and removes an active badge.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(function () {
				return ctx.slots.inject("sidebar.footer.action", function () {
					return ctx.slots.register({
						name: "sidebar.footer.action",
						id: "ds-balance",
						order: 0
					}, BalanceBadge);
				});
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