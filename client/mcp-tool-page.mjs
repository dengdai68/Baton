// Same search and paging projection in the desktop tool list and CLI.
export function mcpToolPage(result,{search='',page=1,all=false}={}) {
  const query=search.trim().toLocaleLowerCase();
  const tools=result.tools.filter(tool=>`${tool.name} ${tool.title || ''} ${tool.description || ''}`.toLocaleLowerCase().includes(query));
  const totalPages=Math.max(1,Math.ceil(tools.length/20)),current=Math.min(page,totalPages);
  return {...result,tools:all?tools:tools.slice((current-1)*20,current*20),total:tools.length,availableTotal:result.total,page:all?null:current,pageSize:all?null:20,totalPages,hasMore:!all && current<totalPages};
}
