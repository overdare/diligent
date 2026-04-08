// @summary Webview bootstrap that mounts the conversation renderer inside VS Code
import { createConversationApp } from "./app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Conversation root element not found");
}

createConversationApp(root);
