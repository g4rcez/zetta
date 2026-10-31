import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { toast } from "sonner";

import { discussionsApi, type DiscussionListItem } from "../discussions/discussions-api";
import {
  chatClient,
  errorMessage,
  type Bot,
  type Conversation,
  type Workspace,
} from "./chat-client";

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
  spaces: Workspace[];
  addSpace: (name: string, parentId?: string) => void;
  rooms: DiscussionListItem[] | undefined;
  reloadRooms: () => Promise<void>;
  /** Starts loading the sidebar data (once) and returns nothing to clean up. */
  load: () => void;
  /** Keeps the room list fresh until the returned function is called. */
  watchRooms: () => () => void;
};

const Ctx = createContext<Value | null>(null);

/**
 * What the shared sidebar shows (bots, chats, workspaces, rooms), kept above the pages so moving between Chat and Rooms does not
 * reload it. It lives inside the signed-in layout, so signing out drops it. Nothing loads until a page asks.
 */
export function SidebarDataProvider({ children }: { children: ReactNode }) {
  const [bots, setBots] = useState<Bot[]>([]);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [chatsLoaded, setChatsLoaded] = useState(false);
  const [spaces, setSpaces] = useState<Workspace[]>([]);
  const [rooms, setRooms] = useState<DiscussionListItem[]>();
  const [watchers, setWatchers] = useState(0);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const loaded = useRef(false);
  const roomsFailed = useRef(false);
  const fail = useCallback((e: unknown) => toast.error(errorMessage(e)), []);

  const refreshBots = useCallback(
    () =>
      chatClient
        .bots()
        .then(setBots)
        .catch(() => {}),
    [],
  );
  const loadChats = useCallback(
    () =>
      chatClient.conversations().then((all) => {
        setChats(all);
        return all;
      }),
    [],
  );
  const load = useCallback(() => {
    if (loaded.current) return;
    loaded.current = true;
    chatClient.workspaces().then(setSpaces).catch(fail);
    chatClient.bots().then(setBots).catch(fail);
    loadChats()
      .then(() => setChatsLoaded(true))
      .catch(fail);
  }, [fail, loadChats]);

  const updateChat = useCallback(
    (id: string, patch: ChatPatch) => {
      const before = chatsRef.current;
      setChats((all) => all.map((c) => (c.id === id ? { ...c, ...patch } : c)));
      chatClient.updateConversation(id, patch).then(
        (row) => setChats((all) => all.map((c) => (c.id === id ? { ...c, ...row } : c))),
        (e) => {
          setChats(before);
          fail(e);
        },
      );
    },
    [fail],
  );
  const addSpace = useCallback(
    (name: string, parentId?: string) =>
      void chatClient
        .createWorkspace(name, parentId)
        .then((w) => setSpaces((s) => [...s, w]), fail),
    [fail],
  );

  const reloadRooms = useCallback(
    () =>
      discussionsApi.list().then(
        (list) => {
          roomsFailed.current = false;
          setRooms(list);
        },
        (e) => {
          setRooms((x) => x ?? []);
          // One toast per outage, not one per poll.
          if (!roomsFailed.current) fail(e);
          roomsFailed.current = true;
        },
      ),
    [fail],
  );
  const watchRooms = useCallback(() => {
    setWatchers((n) => n + 1);
    return () => setWatchers((n) => n - 1);
  }, []);
  const live = rooms?.some((d) => d.running || d.queued > 0);
  const watching = watchers > 0;
  useEffect(() => {
    if (watching) void reloadRooms();
  }, [watching, reloadRooms]);
  // Bots work in the background: refresh often while one is working, slowly otherwise.
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(
      () => {
        if (document.visibilityState === "visible") void reloadRooms();
      },
      live ? 3000 : 15_000,
    );
    return () => clearInterval(t);
  }, [watching, live, reloadRooms]);

  const value = useMemo<Value>(
    () => ({
      bots,
      setBots,
      refreshBots,
      chats,
      setChats,
      chatsLoaded,
      loadChats,
      updateChat,
      spaces,
      addSpace,
      rooms,
      reloadRooms,
      load,
      watchRooms,
    }),
    [
      bots,
      refreshBots,
      chats,
      chatsLoaded,
      loadChats,
      updateChat,
      spaces,
      addSpace,
      rooms,
      reloadRooms,
      load,
      watchRooms,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useValue() {
  const v = useContext(Ctx);
  if (!v) throw new Error("SidebarDataProvider is missing");
  return v;
}

/** Bots, chats and workspaces for the shared sidebar. The first caller starts the load. */
export function useSidebarData() {
  const v = useValue();
  useEffect(() => v.load(), [v.load]);
  return v;
}

/** The user's rooms, refreshed while the caller is mounted. `undefined` until the first answer. */
export function useRooms() {
  const { rooms, reloadRooms, watchRooms } = useValue();
  useEffect(() => watchRooms(), [watchRooms]);
  return { rooms, reload: reloadRooms };
}
