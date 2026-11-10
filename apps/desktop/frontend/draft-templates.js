const heading=text=>({type:'heading',attrs:{level:2},content:[{type:'text',text}]});
const section=text=>[heading(text),{type:'paragraph'}];
export const draftTemplates=[
  {id:'meeting',title:'会议记录',description:'议题、讨论要点、决定和待办',content:{type:'doc',content:['会议主题','讨论要点','形成的决定','接下来要做什么'].flatMap(section)}},
  {id:'reading',title:'阅读笔记',description:'来源、观点、摘录和自己的思考',content:{type:'doc',content:['阅读来源','主要观点','值得保留的摘录','我的理解与问题'].flatMap(section)}},
  {id:'outline',title:'文章提纲',description:'先组织问题、论点和材料',content:{type:'doc',content:['想回答什么问题','我的主要观点','准备使用的材料','文章结构','还需要补充什么'].flatMap(section)}},
];
