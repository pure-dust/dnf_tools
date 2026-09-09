Date.prototype.format = function (fmt: string): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  const pad3 = (n: number) => (n < 10 ? `00${n}` : n < 100 ? `0${n}` : `${n}`);

  return fmt
    .replace(/yyyy/g, this.getFullYear().toString())
    .replace(/yy/g, `${this.getFullYear()}`.slice(-2))
    .replace(/MM/g, pad(this.getMonth() + 1))
    .replace(/M/g, (this.getMonth() + 1).toString())
    .replace(/dd/g, pad(this.getDate()))
    .replace(/d/g, (this.getDate()).toString())
    .replace(/HH/g, pad(this.getHours()))
    .replace(/H/g, (this.getHours()).toString())
    .replace(/hh/g, pad(this.getHours() % 12 || 12))
    .replace(/h/g, (this.getHours() % 12 || 12).toString())
    .replace(/mm/g, pad(this.getMinutes()))
    .replace(/m/g, this.getMinutes().toString())
    .replace(/ss/g, pad(this.getSeconds()))
    .replace(/s/g, this.getSeconds().toString())
    .replace(/SSS/g, pad3(this.getMilliseconds()))
    .replace(/S/g, this.getMilliseconds().toString())
    .replace(/a/g, this.getHours() < 12 ? '上午' : '下午')
    .replace(/A/g, this.getHours() < 12 ? 'AM' : 'PM')
    .replace(/q/g, Math.floor((this.getMonth() + 3) / 3).toString());
};