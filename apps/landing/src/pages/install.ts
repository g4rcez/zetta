// Serves the root install.sh at /install, so the script on the site is always the one in the repository.
import script from "../../../../install.sh?raw";

export const GET = () => new Response(script);
