const BOT_AVATAR_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></svg>';

const LETTER_LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

class ChatBot {
  constructor() {
    this.chatMessages = document.getElementById("chatMessages");
    this.userInput = document.getElementById("userInput");
    this.sendButton = document.getElementById("sendButton");
    this.optionsTray = document.getElementById("optionsTray");
    this.flowTitleEl = document.getElementById("flowTitle");
    this.flowDescEl = document.getElementById("flowDescription");
    this.stepListEl = document.getElementById("stepList");
    this.restartBtn = document.getElementById("restartButton");
    this.sessionId = this.generateSessionId();
    this.sending = false;
    this.typingIndicator = null;

    this.sendButton.addEventListener("click", () => this.handleSend());
    this.userInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.handleSend();
    });
    this.restartBtn.addEventListener("click", () => this.restart());

    this.startConversation();
  }

  generateSessionId() {
    return "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  }

  restart() {
    this.chatMessages.innerHTML = "";
    this.clearOptions();
    this.stepListEl.innerHTML = "";
    this.flowTitleEl.textContent = "";
    this.flowDescEl.textContent = "";
    this.sessionId = this.generateSessionId();
    this.startConversation();
  }

  async handleSend() {
    const message = this.userInput.value.trim();
    if (!message || this.sending) return;
    this.userInput.value = "";
    this.addMessage(message, "user");
    this.clearOptions();
    await this.sendToServer(message);
  }

  async submitOption(text) {
    if (this.sending) return;
    this.addMessage(text, "user");
    this.disableOptions();
    await this.sendToServer(text);
  }

  showTypingIndicator() {
    if (this.typingIndicator) return;
    const row = document.createElement("div");
    row.classList.add("msg-row", "msg-row--ai", "typing-indicator");

    const avatar = document.createElement("div");
    avatar.className = "msg-avatar";
    avatar.innerHTML = BOT_AVATAR_SVG;
    row.appendChild(avatar);

    const body = document.createElement("div");
    body.className = "msg-body";

    const label = document.createElement("div");
    label.className = "msg-sender";
    label.textContent = "Assessment Bot";
    body.appendChild(label);

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.setAttribute("role", "status");
    bubble.setAttribute("aria-live", "polite");
    bubble.setAttribute("aria-label", "Assistant is typing");

    const text = document.createElement("span");
    text.className = "typing-label";
    text.textContent = "Typing";
    bubble.appendChild(text);

    const dots = document.createElement("span");
    dots.className = "typing-dots";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("span");
      dot.className = "typing-dot";
      dots.appendChild(dot);
    }
    bubble.appendChild(dots);

    body.appendChild(bubble);
    row.appendChild(body);
    this.chatMessages.appendChild(row);
    this.typingIndicator = row;
    this.scrollToBottom();
  }

  hideTypingIndicator() {
    if (!this.typingIndicator) return;
    this.typingIndicator.remove();
    this.typingIndicator = null;
  }

  setPending(isPending) {
    this.userInput.disabled = isPending;
    this.sendButton.disabled = isPending;
  }

  async sendToServer(message) {
    this.sending = true;
    this.setPending(true);
    this.showTypingIndicator();
    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, sessionId: this.sessionId }),
      });
      const data = await response.json();
      if (data && data.response) {
        this.displayResponse(data.response);
      } else {
        this.addMessage("Sorry, invalid response from server.", "ai");
      }
      if (data.flowProgress) this.renderProgress(data.flowProgress);
      this.renderOptions(data.options);
    } catch {
      this.addMessage("Sorry, there was an error processing your request.", "ai");
    } finally {
      this.hideTypingIndicator();
      this.setPending(false);
      this.sending = false;
    }
  }

  addMessage(text, sender) {
    const row = document.createElement("div");
    row.classList.add("msg-row", `msg-row--${sender}`);

    if (sender === "ai") {
      const avatar = document.createElement("div");
      avatar.className = "msg-avatar";
      avatar.innerHTML = BOT_AVATAR_SVG;
      row.appendChild(avatar);
    }

    const body = document.createElement("div");
    body.className = "msg-body";

    if (sender === "ai") {
      const label = document.createElement("div");
      label.className = "msg-sender";
      label.textContent = "Assessment Bot";
      body.appendChild(label);
    }

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.textContent = text;
    body.appendChild(bubble);

    row.appendChild(body);
    this.chatMessages.appendChild(row);
    this.scrollToBottom();
  }

  displayResponse(text) {
    this.addMessage(text, "ai");
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  // ── Progress pane ─────────────────────────────────────────
  renderProgress(fp) {
    if (!fp) return;
    this.flowTitleEl.textContent = fp.flowTitle || "";
    this.flowDescEl.textContent = fp.flowDescription || "";
    this.stepListEl.innerHTML = "";

    for (const step of fp.steps) {
      const li = document.createElement("li");
      li.className = `step-item step-item--${step.status}`;

      const icon = document.createElement("span");
      icon.className = "step-icon";
      icon.textContent = step.status === "completed" ? "\u2713" : step.order;

      const content = document.createElement("div");
      content.className = "step-content";

      const header = document.createElement("div");
      header.className = "step-header";

      const label = document.createElement("span");
      label.className = "step-label";
      label.textContent = step.label;
      header.appendChild(label);

      const pct = document.createElement("span");
      pct.className = "step-pct";
      pct.textContent = Math.min(step.percentage ?? 0, 100) + "%";
      header.appendChild(pct);

      content.appendChild(header);

      if (step.status === "in_progress") {
        const statusText = document.createElement("div");
        statusText.className = "step-status-text";
        statusText.textContent = "In Progress";
        content.appendChild(statusText);
      }

      if (step.countable && step.totalQuestions > 0 && step.status !== "upcoming") {
        const detail = document.createElement("div");
        detail.className = "step-progress-detail";
        detail.textContent = `Question ${step.answeredQuestions} of ${step.totalQuestions}`;
        content.appendChild(detail);
      }

      li.appendChild(icon);
      li.appendChild(content);
      this.stepListEl.appendChild(li);
    }
  }

  // ── Option buttons ────────────────────────────────────────
  renderOptions(options) {
    this.clearOptions();
    if (!options || !options.items || options.items.length === 0) return;

    options.items.forEach((item, idx) => {
      const btn = document.createElement("button");
      btn.className = "option-btn";

      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = LETTER_LABELS[idx] || String(idx + 1);
      btn.appendChild(letter);

      const text = document.createElement("span");
      text.textContent = item;
      btn.appendChild(text);

      btn.addEventListener("click", () => this.submitOption(item));
      this.optionsTray.appendChild(btn);
    });
  }

  clearOptions() {
    this.optionsTray.innerHTML = "";
  }

  disableOptions() {
    const buttons = this.optionsTray.querySelectorAll(".option-btn");
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
  }

  async startConversation() {
    this.setPending(true);
    this.showTypingIndicator();
    try {
      const response = await fetch("/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "start", sessionId: this.sessionId }),
      });
      const data = await response.json();
      if (data && data.response) {
        this.displayResponse(data.response);
      }
      if (data.flowProgress) this.renderProgress(data.flowProgress);
      this.renderOptions(data.options);
    } catch {
      this.addMessage("Unable to start conversation.", "ai");
    } finally {
      this.hideTypingIndicator();
      this.setPending(false);
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new ChatBot();
});
