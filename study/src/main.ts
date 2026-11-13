import { mountDemos } from "./demos";

/** Entry for the study page: wires up whichever demos the page contains. */
const demos = mountDemos(document);
// A handle for making the study's own pictures with a fixed time step.
Object.assign(window, { __demos: demos });
