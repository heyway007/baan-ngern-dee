update public.profiles
set display_name = nullif(left(btrim(display_name), 80), '')
where display_name is not null;

alter table public.profiles
add column avatar_path text;

alter table public.profiles
add constraint profiles_display_name_valid
check (
  display_name is null
  or (
    display_name = btrim(display_name)
    and char_length(display_name) between 1 and 80
  )
);

alter table public.profiles
add constraint profiles_avatar_path_owned
check (
  avatar_path is null
  or avatar_path like id::text || '/%'
);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'profile-avatars',
  'profile-avatars',
  false,
  2097152,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
