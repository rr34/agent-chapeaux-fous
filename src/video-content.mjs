function positiveInteger(value, label) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw new Error(`${label} must be a positive integer`);
  return result;
}

export class VideoContent {
  constructor({ videoScripts, organizer }) {
    this.videoScripts = videoScripts;
    this.organizer = organizer;
  }

  listGroups() {
    return this.organizer.listContentGroups();
  }

  add({ videoScriptId, groupId }, context = {}) {
    const scriptId = positiveInteger(videoScriptId, "Video script ID");
    const selectedGroupId = positiveInteger(groupId, "Content group ID");
    const script = this.videoScripts.get(scriptId);
    if (!script) throw Object.assign(new Error("Video script not found"), { statusCode: 404 });
    if (script.render?.status !== "complete" || !script.render.outputFileId) {
      throw Object.assign(
        new Error("The MP4 must finish rendering before it can be added to content"),
        { statusCode: 409 },
      );
    }
    if (script.render.contentId) {
      const content = this.organizer.getContent(script.render.contentId);
      if (content) {
        if (content.groupId !== selectedGroupId) {
          throw Object.assign(
            new Error(`This video is already in ${content.groupName}. Move that content item instead.`),
            { statusCode: 409 },
          );
        }
        return { created: false, unchanged: true, content, script };
      }
    }
    const result = this.organizer.addRenderedVideoToContentSequence({
      groupId: selectedGroupId,
      primaryFileId: script.render.outputFileId,
      title: script.title,
      transcript: script.scriptText,
      description: script.plan.concept,
      publishedAtUtc: script.render.completedAtUtc ?? new Date().toISOString(),
    });
    const linked = this.videoScripts.linkContent(script.id, result.content.id, context);
    return { ...result, script: linked.script };
  }
}
