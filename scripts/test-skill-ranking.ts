// r37 QA: unit-check rankSkillsByRelevance ordering (pure function).
import { rankSkillsByRelevance, buildSkillsBlock } from "../src/lib/skills";
import type { AgentSkill } from "../src/lib/types";

const mk = (id: string, name: string, description: string, body: string): AgentSkill => ({
  id,
  name,
  description,
  body,
  enabled: true,
  chars: body.length,
  addedAt: 0,
});

const coding = mk("s1", "Python Coder", "Write clean python scripts with tests", "PYTHON guidance. Always write unit tests for python functions.");
const web = mk("s2", "Web Researcher", "Search the web and extract facts", "Use web_search, read pages, extract facts from sources.");
const terse = mk("s3", "Terse Talker", "Answer in five words or fewer", "Reply with five words maximum.");

// Task about python → coding skill must rank FIRST.
const out1 = rankSkillsByRelevance([web, coding, terse], "Write a python script that parses CSV files");
console.log("python-task order:", out1.map((s) => s.id).join(","), out1[0].id === "s1" ? "PASS" : "FAIL");

// Task about research → web first.
const out2 = rankSkillsByRelevance([coding, web, terse], "Research the latest news about fusion energy online");
console.log("research-task order:", out2.map((s) => s.id).join(","), out2[0].id === "s2" ? "PASS" : "FAIL");

// No-match task → input order preserved (no silent shuffle).
const out3 = rankSkillsByRelevance([web, coding, terse], "zzz qqq vvv kkk");
console.log("no-match order preserved:", out3.map((s) => s.id).join(",") === "s2,s1,s3" ? "PASS" : "FAIL");

// No task → unchanged.
const out4 = rankSkillsByRelevance([web, coding, terse]);
console.log("no-task unchanged:", out4.map((s) => s.id).join(",") === "s2,s1,s3" ? "PASS" : "FAIL");

// Block builds with ranking applied and stays budgeted.
const block = buildSkillsBlock([web, coding, terse], "Fix the python unit tests in my repo");
console.log("block has python first:", block.indexOf("Python Coder") < block.indexOf("Web Researcher") && block.indexOf("Python Coder") < block.indexOf("Terse Talker") ? "PASS" : "FAIL");
console.log("block length:", block.length);
