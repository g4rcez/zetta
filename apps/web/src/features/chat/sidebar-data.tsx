import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { pollEvery } from "@/lib/query-policy";

import { discussionsQueries, type DiscussionListItem } from "../discussions/discussions-api";
import { teamsQueries, type Team } from "../teams/teams-api";
import { chatClient, errorMessage, type Bot, type Conversation, type Folder } from "./chat-client";
import { chatQueries } from "./chat-queries";

type ChatPatch = { title?: string; pinned?: boolean; favorite?: boolean };

type Value = {
  bots: Bot[];
  setBots: Dispatch<SetStateAction<Bot[]>>;
  refreshBots: () => Promise<void>;
  chats: Conversation[];
  setChats: Dispatch<SetStateAction<Conversation[]>>;
  chatsLoaded: boolean;
  loadChats: () => Promise<Conversation[]>;
  /** Optimistic: the row changes at once and is put back when the server refuses. */
  updateChat: (id: string, patch: ChatPatch) => void;
  /** Optimistic: the row leaves at once and the server delete waits 6 seconds, so the Undo toast can bring it back. */
  deleteChat: (id: string) => void;
  spaces: Folder[];
  addSpace: (name: string, parentId?: string) => void;
  reloadRooms: () => Promise<void>;
  /** Call after a team is created, saved or deleted. */
  reloadTeams: () => Promise<void>;
  /** Starts loading the sidebar data (once) and returns nothing to clean up. */
  load: () => void;
};

const Ctx = createContext<Value | null>(null);

const UNDO_MS = 6000;
const NONE: never[] = [];

/**
 * What the shared sidebar shows (bots, chats, folders), kept in the query cache so moving between Chat and Rooms does not
 * reload it. It lives inside the signed-in layout, so signing out drops it. Nothing loads until a page asks.
 */
export function SidebarDataProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [requested, setRequested] = useState(false);
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);

  const botsQuery = useQuery({ ...chatQueries.bots(), enabled: requested });
  const chatsQuery = useQuery({ ...chatQueries.conversations(), enabled: requested });
  const spacesQuery = useQuery({ ...chatQueries.folders(), enabled: requested });
  const loadError = botsQuery.error ?? chatsQuery.error ?? spacesQuery.error;
  useEffect(() => {
    if (loadError) fail(loadError);
  }, [loadError, fail]);

  const botsKey = chatQueries.bots().queryKey;
  const chatsKey = chatQueries.conversations().queryKey;
  const spacesKey = chatQueries.folders().queryKey;
  const bots = botsQuery.data ?? NONE;
  const chats = chatsQuery.data ?? NONE;
  const spaces = spacesQuery.data ?? NONE;

  const setBots = useCallback<Dispatch<SetStateAction<Bot[]>>>(
    (next) =>
      qc.setQueryData<Bot[]>(botsKey, (old) =>
        typeof next === "function" ? next(old ?? []) : next,
      ),
    [qc, botsKey],
  );
  const setChats = useCallback<Dispatch<SetStateAction<Conversation[]>>>(
    (next) =>
      qc.setQueryData<Conversation[]>(chatsKey, (old) =>
        typeof next === "function" ? next(old ?? []) : next,
      ),
    [qc, chatsKey],
  );
  const refreshBots = useCallback(
    () => qc.invalidateQueries({ queryKey: botsKey, exact: true }),
    [qc, botsKey],
  );
  const loadChats = useCallback(
    () => qc.fetchQuery({ ...chatQueries.conversations(), staleTime: 0 }),
    [qc],
  );
  const load = useCallback(() => setRequested(true), []);

  const updateChat = useCallback(
    (id: string, patch: ChatPatch) => {
      const before = qc.getQueryData<Conversation[]>(chatsKey) ?? [];
      setChats((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      chatClient.updateConversation(id, patch).then(
        (row) => setChats((all) => all.map((c) => (c.id === id ? { ...c, ...row } : c))),
        (e) => {
          setChats(before);
          fail(e);
        },
      );
    },
    [qc, chatsKey, setChats, fail],
  );
  const deleteChat = useCallback(
    (id: string) => {
      const gone = qc.getQueryData<Conversation[]>(chatsKey)?.find((c) => c.id === id);
      if (!gone) return;
      setChats((all) => all.filter((c) => c.id !== id));
      const timer = setTimeout(
        () =>
          void chatClient.deleteConversation(id).catch((e) => {
            setChats((all) => (all.some((c) => c.id === id) ? all : [gone, ...all]));
            fail(e);
          }),
        UNDO_MS,
      );
      toast(`Deleted “${gone.title}”`, {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            clearTimeout(timer);
            setChats((all) => (all.some((c) => c.id === id) ? all : [gone, ...all]));
          },
        },
      });
    },
    [qc, chatsKey, setChats, fail],
  );
  const addSpace = useCallback(
    (name: string, parentId?: string) =>
      void chatClient
        .createFolder(name, parentId)
        .then((w) => qc.setQueryData<Folder[]>(spacesKey, (s) => [...(s ?? []), w]), fail),
    [qc, spacesKey, fail],
  );
  const reloadRooms = useCallback(
    () => qc.invalidateQueries({ queryKey: discussionsQueries.list().queryKey }),
    [qc],
  );
  const reloadTeams = useCallback(() => qc.invalidateQueries({ queryKey: ["teams"] }), [qc]);

  const value = useMemo<Value>(
    () => ({
      bots,
      setBots,
      refreshBots,
      chats,
      setChats,
      chatsLoaded: chatsQuery.isSuccess,
      loadChats,
      updateChat,
      deleteChat,
      spaces,
      addSpace,
      reloadRooms,
      reloadTeams,
      load,
    }),
    [
      bots,
      setBots,
      refreshBots,
      chats,
      setChats,
      chatsQuery.isSuccess,
      loadChats,
      updateChat,
      deleteChat,
      spaces,
      addSpace,
      reloadRooms,
      reloadTeams,
      load,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useValue() {
  const v = useContext(Ctx);
  if (!v) throw new Error("SidebarDataProvider is missing");
  return v;
}

/** Bots, chats and folders for the shared sidebar. The first caller starts the load. */
export function useSidebarData() {
  const v = useValue();
  useEffect(() => v.load(), [v.load]);
  return v;
}

/** Bots work in the background: refresh often while one is working, slowly otherwise. */
const roomsEvery = (rooms: DiscussionListItem[] | undefined) =>
  pollEvery(3000, 15_000, !!rooms?.some((d) => d.running || d.queued > 0));

/** The user's rooms, refreshed while a caller is mounted. `undefined` until the first answer. */
export function useRooms() {
  const { reloadRooms } = useValue();
  const query = useQuery({
    ...discussionsQueries.list(),
    refetchInterval: (q) => roomsEvery(q.state.data),
  });
  useEffect(() => {
    // One toast per outage, not one per poll or per component that shows the list.
    if (query.isError) toast.error(errorMessage(query.error), { id: "rooms-load" });
  }, [query.isError, query.error]);
  return { rooms: query.data ?? (query.isError ? NONE : undefined), reload: reloadRooms };
}

/** The user's teams, shared by every component that shows them (see `reloadTeams`). */
export function useTeams(): Team[] {
  return useQuery(teamsQueries.list()).data ?? NONE;
}
