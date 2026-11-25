// Both editors use ProseMirror, but their schemas differ. Transfer only
// content represented by the target schema. Keep the original draft when a
// non-default property, mark or node cannot be represented there.
export function projectDocument(document, targetSchema, sourceSchema, {checkStructure = true, fromOffice = false} = {}) {
  function project(value, sourceTypes, targetTypes) {
    const prototype = targetTypes[value.type];
    if (!prototype) throw new Error('目标编辑器无法保留这项内容：' + value.type + '。');
    const source = sourceTypes?.[value.type];
    const defaults = source?.defaultAttrs || source?.instance?.attrs;
    const result = {...value};
    if (value.attrs) {
      result.attrs = {};
      for (const [name, attr] of Object.entries(value.attrs)) {
        if (Object.hasOwn(prototype.attrs, name)) result.attrs[name] = attr;
        else if (fromOffice && name === 'block_id') continue;
        else if (attr !== null && JSON.stringify(attr) !== JSON.stringify(defaults?.[name])) {
          throw new Error('目标编辑器无法保留这项格式：' + name + '。');
        }
      }
    }
    if (value.content) result.content = value.content.map(child => project(child, sourceSchema?.nodes, targetSchema.nodes));
    if (value.marks) result.marks = value.marks.map(mark => project(mark, sourceSchema?.marks, targetSchema.marks));
    return result;
  }
  const result = targetSchema.nodeFromJSON(project(document, sourceSchema?.nodes, targetSchema.nodes));
  if (!checkStructure) return result.toJSON();
  result.check();
  return result.toJSON();
}

export function removeOfficePagination(document, schema) {
  const defaults = schema.nodes.pageBlock?.defaultAttrs;
  const content = (document.content || []).flatMap(node => {
    if (node.type !== 'pageBlock') return [node];
    for (const [name, value] of Object.entries(node.attrs || {})) {
      if (value !== null && JSON.stringify(value) !== JSON.stringify(defaults?.[name])) {
        throw new Error('WorkProof 无法保留这项分页设置：' + name + '。');
      }
    }
    return node.content || [];
  });
  return {...document, content};
}
