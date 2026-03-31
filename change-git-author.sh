#!/bin/bash

# Git提交用户名和邮箱修改脚本
# 同时修改 author 和 committer，支持本地配置和历史重写

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_usage() {
    cat << EOF
用法: ./change-git-author.sh [选项]

选项:
  -h, --help                显示此帮助信息
  -n, --name NAME           新的用户名
  -e, --email EMAIL         新的邮箱
  -on, --old-name NAME      旧的用户名（仅改写匹配该名字的提交）
  -oe, --old-email EMAIL    旧的邮箱（仅改写匹配该邮箱的提交）
  -r, --rewrite             改写历史提交（author + committer 均会修改）
  -l, --local               仅改变本地配置（默认，仅影响未来的提交）

示例:
  # 修改当前仓库配置（仅影响未来的提交）
  ./change-git-author.sh -n "张三" -e "zhangsan@example.com"

  # 改写所有历史提交的 author 和 committer
  ./change-git-author.sh -n "张三" -e "zhangsan@example.com" -r

  # 只改写旧邮箱匹配的历史提交
  ./change-git-author.sh -oe "old@example.com" -n "新名字" -e "new@example.com" -r

EOF
}

# 初始化变量
NEW_NAME=""
NEW_EMAIL=""
OLD_NAME=""
OLD_EMAIL=""
REWRITE_HISTORY=false

# 解析命令行参数
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            print_usage
            exit 0
            ;;
        -n|--name)
            NEW_NAME="$2"
            shift 2
            ;;
        -e|--email)
            NEW_EMAIL="$2"
            shift 2
            ;;
        -on|--old-name)
            OLD_NAME="$2"
            shift 2
            ;;
        -oe|--old-email)
            OLD_EMAIL="$2"
            shift 2
            ;;
        -r|--rewrite)
            REWRITE_HISTORY=true
            shift
            ;;
        -l|--local)
            REWRITE_HISTORY=false
            shift
            ;;
        *)
            echo -e "${RED}未知选项: $1${NC}"
            print_usage
            exit 1
            ;;
    esac
done

# 验证是否在git仓库中
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    echo -e "${RED}错误: 不在git仓库中${NC}"
    exit 1
fi

# 验证必需参数
if [ -z "$NEW_NAME" ] || [ -z "$NEW_EMAIL" ]; then
    echo -e "${RED}错误: 必须指定新的用户名(-n)和邮箱(-e)${NC}"
    print_usage
    exit 1
fi

# 验证邮箱格式
if ! [[ "$NEW_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo -e "${RED}错误: 邮箱格式不正确: $NEW_EMAIL${NC}"
    exit 1
fi

echo -e "${YELLOW}===== Git提交信息修改 =====${NC}"
echo "新用户名: $NEW_NAME"
echo "新邮箱:   $NEW_EMAIL"

if [ "$REWRITE_HISTORY" = true ]; then
    echo -e "${YELLOW}模式: 改写历史提交（author + committer）${NC}"

    # 有旧值时只改写匹配的提交，否则改写全部
    if [ -n "$OLD_NAME" ] || [ -n "$OLD_EMAIL" ]; then
        [ -n "$OLD_NAME" ]  && echo "旧用户名: $OLD_NAME"
        [ -n "$OLD_EMAIL" ] && echo "旧邮箱:   $OLD_EMAIL"
        FILTER_MODE="match"
    else
        echo -e "${YELLOW}未指定旧值，将改写全部提交${NC}"
        FILTER_MODE="all"
    fi

    echo -e "${RED}警告: 这将改写仓库的提交历史，强烈建议执行前备份仓库！${NC}"
    read -p "确定要继续吗? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "操作已取消"
        exit 1
    fi

    # 导出变量供 --env-filter 子 shell 使用
    export OLD_NAME OLD_EMAIL NEW_NAME NEW_EMAIL FILTER_MODE

    if command -v git-filter-repo &>/dev/null; then
        # ---- 优先使用现代工具 git-filter-repo ----
        echo -e "${YELLOW}使用 git-filter-repo 改写...${NC}"

        CALLBACK=$(mktemp /tmp/git-fr-callback-XXXXXX.py)
        if [ "$FILTER_MODE" = "all" ]; then
            cat > "$CALLBACK" << PYEOF
import os
new_name  = os.environ['NEW_NAME'].encode()
new_email = os.environ['NEW_EMAIL'].encode()

def commit_callback(commit):
    commit.author_name    = new_name
    commit.author_email   = new_email
    commit.committer_name  = new_name
    commit.committer_email = new_email
PYEOF
        else
            cat > "$CALLBACK" << PYEOF
import os
old_name  = os.environ.get('OLD_NAME',  '').encode()
old_email = os.environ.get('OLD_EMAIL', '').encode()
new_name  = os.environ['NEW_NAME'].encode()
new_email = os.environ['NEW_EMAIL'].encode()

def commit_callback(commit):
    if (old_name  and commit.author_name    == old_name)  or \
       (old_email and commit.author_email   == old_email):
        commit.author_name  = new_name
        commit.author_email = new_email
    if (old_name  and commit.committer_name  == old_name)  or \
       (old_email and commit.committer_email == old_email):
        commit.committer_name  = new_name
        commit.committer_email = new_email
PYEOF
        fi

        git-filter-repo --commit-callback "$(cat "$CALLBACK")" --force
        rm -f "$CALLBACK"
    else
        # ---- 回退到 git filter-branch ----
        echo -e "${YELLOW}未检测到 git-filter-repo，回退到 git filter-branch...${NC}"

        if [ "$FILTER_MODE" = "all" ]; then
            git filter-branch -f --env-filter '
                export GIT_AUTHOR_NAME="$NEW_NAME"
                export GIT_AUTHOR_EMAIL="$NEW_EMAIL"
                export GIT_COMMITTER_NAME="$NEW_NAME"
                export GIT_COMMITTER_EMAIL="$NEW_EMAIL"
            ' --tag-name-filter cat -- --all
        else
            git filter-branch -f --env-filter '
                MATCH_AUTHOR=false
                MATCH_COMMITTER=false
                [ -n "$OLD_NAME"  ] && [ "$GIT_AUTHOR_NAME"    = "$OLD_NAME"  ] && MATCH_AUTHOR=true
                [ -n "$OLD_EMAIL" ] && [ "$GIT_AUTHOR_EMAIL"   = "$OLD_EMAIL" ] && MATCH_AUTHOR=true
                [ -n "$OLD_NAME"  ] && [ "$GIT_COMMITTER_NAME"  = "$OLD_NAME"  ] && MATCH_COMMITTER=true
                [ -n "$OLD_EMAIL" ] && [ "$GIT_COMMITTER_EMAIL" = "$OLD_EMAIL" ] && MATCH_COMMITTER=true
                if [ "$MATCH_AUTHOR" = true ]; then
                    export GIT_AUTHOR_NAME="$NEW_NAME"
                    export GIT_AUTHOR_EMAIL="$NEW_EMAIL"
                fi
                if [ "$MATCH_COMMITTER" = true ]; then
                    export GIT_COMMITTER_NAME="$NEW_NAME"
                    export GIT_COMMITTER_EMAIL="$NEW_EMAIL"
                fi
            ' --tag-name-filter cat -- --all
        fi
    fi

    echo -e "${GREEN}✓ 历史提交已改写（author 和 committer 均已更新）${NC}"
    echo -e "${YELLOW}提示: 推送远程仓库需执行 git push --force${NC}"

else
    echo -e "${YELLOW}模式: 修改本地配置（仅影响未来的提交）${NC}"

    git config user.name  "$NEW_NAME"
    git config user.email "$NEW_EMAIL"

    echo -e "${GREEN}✓ 本地配置已更新${NC}"
fi

# 显示当前配置
echo -e "\n${YELLOW}当前本地配置:${NC}"
echo "用户名: $(git config user.name)"
echo "邮箱:   $(git config user.email)"

echo -e "\n${GREEN}完成！${NC}"
