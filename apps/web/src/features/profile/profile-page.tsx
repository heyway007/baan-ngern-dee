import {
  PROFILE_AVATAR_MAX_BYTES,
  type UserProfile
} from "@systems-credit/contracts";
import { Camera, RefreshCw, Save, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent
} from "react";

import {
  ProfileApiFailure,
  type ProfileApi
} from "../../lib/profile-api";
import { ProfileAvatar } from "./profile-avatar";

type ProfilePageProps = Readonly<{
  profile: UserProfile;
  api: ProfileApi;
  loading: boolean;
  loadError?: string;
  onRetry(): void;
  onProfileChanged(profile: UserProfile): void;
}>;

const acceptedAvatarTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp"
]);

function mutationError(error: unknown, fallback: string): string {
  return error instanceof ProfileApiFailure ? error.message : fallback;
}

export function ProfilePage({
  profile,
  api,
  loading,
  loadError,
  onRetry,
  onProfileChanged
}: ProfilePageProps) {
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [savingName, setSavingName] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [removingAvatar, setRemovingAvatar] = useState(false);
  const [mutationAlert, setMutationAlert] = useState<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const clearPreview = useCallback(() => {
    const currentUrl = previewUrlRef.current;
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      previewUrlRef.current = null;
    }
    setPreviewUrl(null);
  }, []);

  useEffect(() => {
    setDisplayName(profile.displayName);
  }, [profile.displayName, profile.userId]);

  useEffect(() => clearPreview, [clearPreview]);

  async function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (
      !trimmedName ||
      trimmedName === profile.displayName ||
      savingName
    ) {
      return;
    }

    setSavingName(true);
    setMutationAlert(null);
    try {
      const nextProfile = await api.update({
        displayName: trimmedName
      });
      setDisplayName(nextProfile.displayName);
      onProfileChanged(nextProfile);
    } catch (error) {
      setMutationAlert(
        mutationError(
          error,
          "ไม่สามารถบันทึกชื่อได้ กรุณาลองใหม่"
        )
      );
    } finally {
      setSavingName(false);
    }
  }

  async function selectAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || uploadingAvatar || removingAvatar) return;

    setMutationAlert(null);
    if (file.size > PROFILE_AVATAR_MAX_BYTES) {
      setMutationAlert("รูปโปรไฟล์ต้องมีขนาดไม่เกิน 2 MB");
      return;
    }
    if (!acceptedAvatarTypes.has(file.type)) {
      setMutationAlert("รองรับเฉพาะไฟล์ JPG, PNG หรือ WebP");
      return;
    }

    clearPreview();
    const localUrl = URL.createObjectURL(file);
    previewUrlRef.current = localUrl;
    setPreviewUrl(localUrl);
    setUploadingAvatar(true);

    try {
      const nextProfile = await api.replaceAvatar(file);
      onProfileChanged(nextProfile);
      clearPreview();
    } catch (error) {
      clearPreview();
      setMutationAlert(
        mutationError(
          error,
          "ไม่สามารถอัปโหลดรูปโปรไฟล์ได้ กรุณาลองใหม่"
        )
      );
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function removeAvatar() {
    if (removingAvatar || uploadingAvatar) return;

    setRemovingAvatar(true);
    setMutationAlert(null);
    try {
      const nextProfile = await api.removeAvatar();
      onProfileChanged(nextProfile);
    } catch (error) {
      setMutationAlert(
        mutationError(error, "ไม่สามารถลบรูปโปรไฟล์ได้ กรุณาลองใหม่")
      );
    } finally {
      setRemovingAvatar(false);
    }
  }

  const trimmedName = displayName.trim();
  const avatarMutationPending = uploadingAvatar || removingAvatar;

  return (
    <main className="page-content profile-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">ข้อมูลส่วนตัว</span>
          <h1>โปรไฟล์ของฉัน</h1>
          <p>ปรับชื่อและรูปที่ใช้แสดงในระบบ</p>
        </div>
      </div>

      {loading ? (
        <p className="profile-load-status" role="status">
          <RefreshCw className="spin" size={18} aria-hidden="true" />
          กำลังโหลดโปรไฟล์…
        </p>
      ) : null}

      {loadError ? (
        <div className="profile-load-error" role="alert">
          <span>{loadError}</span>
          <button
            type="button"
            className="secondary-button"
            onClick={onRetry}
            disabled={loading}
          >
            <RefreshCw size={18} aria-hidden="true" />
            ลองอีกครั้ง
          </button>
        </div>
      ) : null}

      {mutationAlert ? (
        <p className="form-error profile-mutation-alert" role="alert">
          {mutationAlert}
        </p>
      ) : null}

      <section className="content-card profile-card">
        <div className="profile-avatar-section">
          <ProfileAvatar
            displayName={profile.displayName}
            url={previewUrl ?? profile.avatar.url}
            size="large"
          />
          <div className="profile-avatar-copy">
            <h2>รูปโปรไฟล์</h2>
            <p>รองรับ JPG, PNG และ WebP ขนาดไม่เกิน 2 MB</p>
            <div className="profile-avatar-actions">
              <label
                className={`secondary-button profile-avatar-picker${
                  avatarMutationPending ? " disabled" : ""
                }`}
                htmlFor="profile-avatar-file"
              >
                <Camera size={18} aria-hidden="true" />
                {uploadingAvatar ? "กำลังอัปโหลด" : "เลือกรูป"}
              </label>
              <input
                id="profile-avatar-file"
                className="profile-avatar-file"
                type="file"
                aria-label="เลือกรูปโปรไฟล์"
                accept=".jpg,.jpeg,.png,.webp"
                disabled={avatarMutationPending}
                onChange={(event) => void selectAvatar(event)}
              />
              {profile.avatar.source === "custom" ? (
                <button
                  type="button"
                  className="ghost-button profile-avatar-remove"
                  aria-label={
                    removingAvatar ? "กำลังลบรูป" : "ลบรูป"
                  }
                  disabled={avatarMutationPending}
                  onClick={() => void removeAvatar()}
                >
                  <Trash2 size={18} aria-hidden="true" />
                  {removingAvatar ? "กำลังลบรูป" : "ลบรูป"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <form className="profile-form" onSubmit={(event) => void saveName(event)}>
          <label htmlFor="profile-display-name">ชื่อที่แสดง</label>
          <input
            id="profile-display-name"
            value={displayName}
            maxLength={80}
            autoComplete="name"
            disabled={savingName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <div className="profile-form-actions">
            <button
              type="submit"
              className="primary-button"
              aria-label={
                savingName ? "กำลังบันทึกชื่อ" : "บันทึกชื่อ"
              }
              disabled={
                savingName ||
                !trimmedName ||
                trimmedName === profile.displayName
              }
            >
              <Save size={18} aria-hidden="true" />
              {savingName ? "กำลังบันทึก" : "บันทึกชื่อ"}
            </button>
          </div>
        </form>

        <div
          className="profile-account"
          role="group"
          aria-labelledby="profile-account-label"
        >
          <span
            id="profile-account-label"
            className="profile-account-label"
          >
            ช่องทางเข้าสู่ระบบ
          </span>
          <strong className="profile-account-value">
            {profile.accountChannel.label}
          </strong>
          <small>ข้อมูลนี้แก้ไขไม่ได้</small>
        </div>
      </section>
    </main>
  );
}
