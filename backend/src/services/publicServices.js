const AUTH_URL = (process.env.PART_AUTH_URL || "http://authentication-v7-dev.partdp.ir").replace(/\/$/, "");
const PROFILE_URL = (process.env.PART_PROFILE_URL || "http://profile-v7-dev.partdp.ir").replace(/\/$/, "");
const SYSTEM = process.env.PART_AUTH_SYSTEM || "mojtaba_soltanahmadi";
const USER = process.env.PART_AUTH_USER || "mojtaba_soltanahmadi";
const PASS = process.env.PART_AUTH_PASS || "mojtaba_soltanahmadi";

const authHeaders = {
  "Content-Type": "application/json",
  "user": USER,
  "pass": PASS
};

// ۱) ثبت کاربر در سرویس احراز هویت متمرکز
export async function addAuthUser({ username, password }) {
  const url = `${AUTH_URL}/service/authentication@7/authEntry`;
  const response = await fetch(url, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      system: SYSTEM,
      status: "active",
      fields: { username, password }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.meta?.code;
    const faMsg = payload?.data?.message?.fa || "";
    if (code === "duplicateEntry" || response.status === 409 || faMsg.includes("تکراری") || code?.toLowerCase().includes("duplicate")) {
      const err = new Error("این نام کاربری قبلاً ثبت شده است.");
      err.code = "ACCOUNT_EXISTS";
      err.status = 409;
      throw err;
    }
    const err = new Error(payload?.data?.message?.fa || payload?.data?.message?.en || "خطا در ثبت کاربر در سامانه احراز هویت");
    err.status = response.status;
    throw err;
  }
  return payload?.data;
}

// ۲) تصدیق اصالت در سرویس احراز هویت متمرکز
export async function authenticateUser({ username, password }) {
  const url = `${AUTH_URL}/service/authentication@7/authenticate`;
  const response = await fetch(url, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      system: SYSTEM,
      fields: { username, password }
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const err = new Error("نام کاربری یا رمز عبور نادرست است.");
    err.code = "INVALID_CREDENTIALS";
    err.status = 401;
    throw err;
  }
  return payload?.data;
}

// ۳) ایجاد پروفایل شخص حقیقی در سرویس اشخاص
export async function addProfileReal({ idNumber, fullName, email }) {
  const url = `${PROFILE_URL}/service/profile@7/profile`;
  const parts = (fullName || "").trim().split(/\s+/);
  const firstName = parts[0] || "کاربر";
  const lastName = parts.slice(1).join(" ") || firstName;

  const response = await fetch(url, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({
      type: "real",
      uniqueKey: idNumber,
      idNumber: idNumber,
      firstName: firstName,
      lastName: lastName,
      gender: 1,
      birthday: "1370/01/01",
      email: email || undefined,
      system: SYSTEM
    })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    console.warn("[profileService] addProfile warning:", payload?.data?.message?.fa || payload?.data?.message?.en);
  }
  return payload?.data;
}

// ۴) استعلام پروفایل شخص بر اساس کد ملی
export async function getProfileByIdNumber(idNumber) {
  const url = `${PROFILE_URL}/service/profile@7/profile?idNumber=${idNumber}&system=${SYSTEM}`;
  const response = await fetch(url, {
    method: "GET",
    headers: authHeaders
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data?.real?.length) {
    return null;
  }
  return payload.data.real[0];
}
