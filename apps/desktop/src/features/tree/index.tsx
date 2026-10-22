import { ProjectTreeBase } from './ProjectTree.js';
import { Welcome } from './Welcome.js';
import './tree.css';

/** The left navigator; `ProjectTree.Welcome` is the screen shown when no project is open. */
export const ProjectTree = Object.assign(ProjectTreeBase, { Welcome });
