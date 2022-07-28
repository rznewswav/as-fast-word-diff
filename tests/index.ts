import wd = require("../build/debug");
const { diff } = wd;

function worddiff(text1: string, text2: string): ReturnType<typeof diff> {
  // only pass fix_unicode=true at the top level, not when diff_main is
  // recursively invoked
  const diffArr = diff(text1.split(" "), text2.split(" "));

  return diffArr;
}
console.log(
  worddiff(
    "this is a very long string but we have the same tail and i cannot fanthom how long this thing is like seriously but we have the same tail",
    "this is an extremely long thread but we have the same tail and i can't even begin to imagine how long it is but we have the same tail"
  )
);
