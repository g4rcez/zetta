/**
 * Header the server writes itself, from the socket (or from the one header an operator trusts), before a request reaches Better Auth.
 * The rate limiter reads only this header, so a client cannot choose its own bucket and clients do not share one.
 */
export const CLIENT_IP_HEADER = "x-zetta-client-ip";
