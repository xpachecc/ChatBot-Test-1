class ChatBot {
  constructor() {
    this.chatMessages = document.getElementById("chatMessages");
    this.userInput = document.getElementById("userInput");
    this.sendButton = document.getElementById("sendButton");
    this.sessionId = this.generateSessionId();

    this.sendButton.addEventListener("click", () => this.handleSend());
    this.userInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        this.handleSend();
      }
    });

    // kick off conversation to get intro from backend
    this.startConversation();
  }

  generateSessionId() {
    return "session_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
  }

  async handleSend() {
    const message = this.userInput.value.trim();
    if (!message) return;

    this.userInput.value = "";
    this.addMessage(message, "user");

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
    } catch (err) {
      this.addMessage("Sorry, there was an error processing your request.", "ai");
    }
  }

  addMessage(text, sender) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", `${sender}-message`);
    messageDiv.textContent = text;
    this.chatMessages.appendChild(messageDiv);
    this.scrollToBottom();
  }

  displayResponse(text) {
    const messageDiv = document.createElement("div");
    messageDiv.classList.add("message", "ai-message");
    messageDiv.textContent = text;
    this.chatMessages.appendChild(messageDiv);
    this.scrollToBottom();
  }

  scrollToBottom() {
    this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
  }

  async startConversation() {
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
    } catch (err) {
      this.addMessage("Unable to start conversation.", "ai");
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  new ChatBot();
});