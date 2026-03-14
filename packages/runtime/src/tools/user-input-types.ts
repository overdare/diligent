// @summary Runtime-owned request_user_input request/response types shared by app-server, collab, and clients

export interface UserInputOption {
  label: string;
  description: string;
}

export interface UserInputQuestion {
  id: string;
  header: string;
  question: string;
  options: UserInputOption[];
  allow_multiple?: boolean;
  is_other?: boolean;
  is_secret?: boolean;
}

export interface UserInputSource {
  threadId: string;
  nickname: string;
}

export interface UserInputRequest {
  questions: UserInputQuestion[];
  source?: UserInputSource;
}

export interface UserInputResponse {
  answers: Record<string, string | string[]>;
}
