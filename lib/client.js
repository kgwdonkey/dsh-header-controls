window.__ModuleLoader__.load({
  id: "dsh-header-controls",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    var React = require("react");
    var createElement = React.createElement;
    var useState = React.useState;
    var useEffect = React.useEffect;

    var BASE = "/dsh-header-controls";

    // 与官方 Session log 胶囊按钮一致的版式（对齐 dsh-session-log-export 的 HeaderAction.module.css）
    var CAPSULE = {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: "64px",
      height: "32px",
      padding: "6px 12px",
      gap: "4px",
      border: "1px solid var(--dsw-alias-border-l2)",
      borderRadius: "18px",
      color: "var(--dsw-alias-label-primary)",
      background: "transparent",
      fontFamily: "var(--dsw-font-family)",
      fontSize: "13px",
      fontWeight: "400",
      lineHeight: "20px",
      cursor: "pointer",
    };

    function post(path) {
      fetch(path, { method: "POST", headers: { "x-dsh-header-controls": "1" } }).catch(function () {});
    }

    // maid-atelier 皮肤感知：皮肤开启（html/body 带 data-dsh-maid-atelier）时
    // 用皮肤自有配色（深海蓝底 + 陶瓷白字 + 柔金描边），关闭时恢复原始胶囊配色。
    function skinActive() {
      var d = typeof document !== "undefined" ? document.documentElement : null;
      var b = typeof document !== "undefined" ? document.body : null;
      return !!((d && d.hasAttribute("data-dsh-maid-atelier")) || (b && b.hasAttribute("data-dsh-maid-atelier")));
    }

    function capsuleStyle(skin) {
      var s = Object.assign({}, CAPSULE);
      if (skin) {
        s.background = "var(--maid-navy-800, #0b1f3a)";
        s.borderColor = "var(--maid-gold-soft, var(--maid-gold, #c5a468))";
        s.color = "var(--maid-porcelain, #f4f1ea)";
      }
      return s;
    }

    function PowerButton(props) {
      var armedState = useState(false);
      var armed = armedState[0];
      var setArmed = armedState[1];
      var doneState = useState(false);
      var done = doneState[0];
      var setDone = doneState[1];
      var skinState = useState(skinActive);
      var skin = skinState[0];
      var setSkin = skinState[1];
      var needConfirm = props.confirm !== false; // 注销=两步确认；重启=一键直达

      // 皮肤开关由属性决定：观察 html/body 的 attribute 变化并同步（含清理）
      useEffect(function () {
        function sync() { setSkin(skinActive()); }
        sync();
        if (typeof MutationObserver === "undefined") return;
        var observer = new MutationObserver(sync);
        var targets = [document.documentElement, document.body];
        for (var i = 0; i < targets.length; i++) {
          if (targets[i]) observer.observe(targets[i], { attributes: true, attributeFilter: ["data-dsh-maid-atelier"] });
        }
        return function () { observer.disconnect(); };
      }, []);

      useEffect(function () {
        if (!armed) return;
        var t = setTimeout(function () { setArmed(false); }, 5000);
        return function () { clearTimeout(t); };
      }, [armed]);

      var style = capsuleStyle(skin);
      var label = props.label;
      if (done) {
        label = props.doneLabel || "已完成";
        style.color = skin ? "var(--maid-gold-soft, #c5a468)" : "var(--dsw-alias-label-dimmed)";
        style.cursor = "default";
      } else if (needConfirm && armed) {
        label = "确认" + props.label + "?";
        style.borderColor = "var(--dsw-alias-state-error-primary)";
        style.color = "var(--dsw-alias-state-error-primary)";
        style.background = "color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)";
      }

      function onClick() {
        if (done) return;
        if (needConfirm && !armed) { setArmed(true); return; }
        setArmed(false);
        props.execute(setDone);
      }

      return createElement("button", {
        type: "button",
        onClick: onClick,
        title: props.title || "",
        "aria-label": props.label,
        style: style,
      }, createElement("span", { style: { whiteSpace: "nowrap" } }, label));
    }

    // 重启后轮询服务器，恢复即刷新本页（复用当前标签页，不再开新窗口）
    function pollAndReload() {
      var attempts = 0;
      setTimeout(function () {
        var tick = function () {
          attempts++;
          if (attempts > 100) return; // ~2 分钟放弃
          fetch("/", { method: "GET", cache: "no-store" })
            .then(function (r) {
              if (r.ok) { try { location.reload(); } catch (e) {} }
              else setTimeout(tick, 1200);
            })
            .catch(function () { setTimeout(tick, 1200); });
        };
        tick();
      }, 7000);
    }

    function doRestart(setDone) {
      post(BASE + "/restart");
      setDone(true);
      pollAndReload();
    }

    function doExit(setDone) {
      post(BASE + "/exit");
      setTimeout(function () {
        try { window.close(); } catch (e) {}
      }, 300);
      setDone(true);
    }

    function PowerStrip() {
      return createElement("div", { style: { display: "inline-flex", gap: "6px", alignItems: "center" } },
        createElement(PowerButton, { label: "重启", confirm: false, doneLabel: "重启中…", title: "一键重启 DeepSeek Harness（服务重启后本页自动刷新）", execute: doRestart }),
        createElement(PowerButton, { label: "注销", title: "关闭 DeepSeek Harness 进程（再次点击确认；再次启动可双击桌面快捷方式）", doneLabel: "已注销", execute: doExit })
      );
    }

    var name = "dsh-header-controls";
    var inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("conversation.session.header.utilities", function () {
        return ctx.slots.register(
          { name: "conversation.session.header.utilities", id: "header-power", order: -10, label: "电源" },
          PowerStrip
        );
      });
    }

    exports.apply = apply;
    exports.inject = inject;
    exports.name = name;
    return module.exports;
  }
});
