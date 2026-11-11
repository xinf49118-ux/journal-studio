/* Serialize writes so a slow older save can never overwrite a newer draft. */
export class DraftSaver {
  constructor(write, status = () => {}) {
    this.write = write; this.status = status; this.tail = Promise.resolve(); this.saved = null; this.revision = 0;
  }
  save(project) {
    const payload = JSON.stringify(project);
    const revision = ++this.revision;
    this.status('saving', '保存中…');
    const task = this.tail.catch(() => {}).then(async () => {
      if (payload !== this.saved) {
        const result = await this.write(JSON.parse(payload));
        if (result?.ok === false) throw new Error('存储空间不足或浏览器禁止保存，请导出备份');
        this.saved = payload;
      }
      if (revision === this.revision) this.status('saved', '已保存');
    }).catch(error => {
      if (revision === this.revision) this.status('error', '保存失败 · 请导出备份');
      throw error;
    });
    this.tail = task;
    return task;
  }
}
