import { createContext, useContext } from "react";

/** What a setup card can do in the chat that shows it: post a short message as the person. Absent outside a chat (the card then only shows its state). */
export type SetupActions = { say: (text: string) => void };
export const SetupActionsContext = createContext<SetupActions | null>(null);
export const useSetupActions = () => useContext(SetupActionsContext);
